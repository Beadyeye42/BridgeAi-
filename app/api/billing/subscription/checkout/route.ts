import { after, NextResponse } from "next/server";
import { requireSupplierApi } from "@/lib/auth/api";
import { prisma, runAsDatabaseWorker } from "@/lib/db";
import { applicationOrigin } from "@/lib/config";
import { ensureMembershipPlanStripePrice, ensureMembershipPromotionStripeCoupon, getStripe } from "@/lib/stripe/server";
import { membershipCheckoutSchema, validationError } from "@/lib/auth/validation";
import { runProductionMonitoringSafely } from "@/lib/monitoring/operational-alerts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const membership = auth.session.user.memberships.find((item) => item.supplierCompanyId === auth.companyId);
  if (!membership || !["OWNER", "MANAGER"].includes(membership.role)) return NextResponse.json({ error: "Owner or manager access required" }, { status: 403 });
  if (membership.supplierCompany.status !== "APPROVED") return NextResponse.json({ error: "Supplier approval is required before subscribing" }, { status: 409 });

  const parsed = membershipCheckoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });

  try {
    const plan = await prisma.membershipPlan.findFirst({ where: { id: parsed.data.membershipPlanId, active: true } });
    const current = await prisma.subscription.findUnique({ where: { supplierCompanyId: auth.companyId }, include: { membershipPlan: true } });
    if (!plan) return NextResponse.json({ error: "That membership plan is not available" }, { status: 404 });
    if (plan.tier === "HYPERLOCAL") {
      const eligibleCategory = await prisma.supplierProductCategory.findFirst({
        where: {
          supplierCompanyId: auth.companyId,
          OR: [
            { productCategory: { hyperlocalEnabled: true, parentId: null, active: true } },
            { productCategory: { active: true, parent: { hyperlocalEnabled: true, active: true } } },
          ],
        },
        select: { productCategoryId: true },
      });
      const activeCoverage = await prisma.coverageArea.findMany({
        where: { supplierCompanyId: auth.companyId, active: true },
        select: { type: true, radiusMiles: true },
      });
      if (!eligibleCategory) return NextResponse.json({ error: "Hyperlocal Partner is not available for the industries your company currently supplies" }, { status: 409 });
      if (!activeCoverage.some((area) => area.type === "DISTANCE" && area.radiusMiles !== null && area.radiusMiles >= 1 && area.radiusMiles <= (plan.maximumRadiusMiles ?? 10))) {
        return NextResponse.json({ error: `Choose a coverage radius between 1 and ${plan.maximumRadiusMiles ?? 10} miles before selecting Hyperlocal Partner`, actionUrl: "/dashboard/coverage" }, { status: 409 });
      }
      if (activeCoverage.some((area) => area.type === "NATIONWIDE" || (area.radiusMiles ?? 0) > (plan.maximumRadiusMiles ?? 10))) {
        return NextResponse.json({ error: `Reduce every active coverage area to ${plan.maximumRadiusMiles ?? 10} miles or less before selecting Hyperlocal Partner`, actionUrl: "/dashboard/coverage" }, { status: 409 });
      }
    }
    const stripe = getStripe();
    const priceId = await ensureMembershipPlanStripePrice(plan);
    const origin = applicationOrigin(request.url);
    const now = new Date();
    let applicablePromotion = await runAsDatabaseWorker("stripe_billing", async (tx) => {
      const promotion = await tx.membershipPromotion.findFirst({
        where: {
          active: true,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          eligiblePlanCodes: { has: plan.code },
        },
        orderBy: [{ promotionalPricePence: "asc" }, { startsAt: "asc" }],
      });
      if (!promotion?.subscriberLimit) return promotion;
      const claimed = await tx.subscription.count({ where: { promotionId: promotion.id, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } } });
      return claimed < promotion.subscriberLimit ? promotion : null;
    });
    if (current?.status === "ACTIVE" && applicablePromotion && !applicablePromotion.existingSubscribersQualify) applicablePromotion = null;
    const promotionCouponId = applicablePromotion ? await ensureMembershipPromotionStripeCoupon(applicablePromotion, plan) : null;

    if (current?.status === "ACTIVE") {
      if (current.accessSource === "COMPLIMENTARY") return NextResponse.json({ error: "Your complimentary access is active. An administrator can change its tier." }, { status: 409 });
      if (!current.providerSubscriptionId) throw new Error("Active Stripe subscription reference is missing");
      if (current.membershipPlanId === plan.id) return NextResponse.json({ error: `${plan.name} is already active` }, { status: 409 });
      const providerSubscription = await stripe.subscriptions.retrieve(current.providerSubscriptionId);
      const item = providerSubscription.items.data[0];
      if (!item) throw new Error("Stripe subscription item is missing");
      await stripe.subscriptions.update(providerSubscription.id, {
        items: [{ id: item.id, price: priceId }],
        proration_behavior: "create_prorations",
        discounts: promotionCouponId ? [{ coupon: promotionCouponId }] : undefined,
        metadata: { ...providerSubscription.metadata, supplierCompanyId: auth.companyId, membershipPlanId: plan.id, planCode: plan.code, membershipTier: plan.tier, membershipPromotionId: applicablePromotion?.id ?? "" },
      });
      await runAsDatabaseWorker("stripe_billing", async (tx) => {
        await tx.subscription.update({ where: { id: current.id }, data: { membershipPlanId: plan.id, planCode: plan.code, promotionId: applicablePromotion?.id ?? null } });
        const tierRank = { HYPERLOCAL: 0, LOCAL: 1, REGIONAL: 2, NATIONWIDE: 3 } as const;
        const fromTier = current.membershipPlan?.tier ?? null;
        const direction = fromTier === null || fromTier === plan.tier ? "UNCHANGED" : tierRank[plan.tier] > tierRank[fromTier] ? "UPGRADE" : "DOWNGRADE";
        await tx.auditLog.create({ data: { actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "BILLING.MEMBERSHIP_PLAN_CHANGED", entityType: "Subscription", entityId: current.id, summary: `Membership changed to ${plan.name}`, metadata: { membershipPlanId: plan.id, fromTier, toTier: plan.tier, direction, monthlyPricePence: plan.monthlyPricePence } } });
      });
      return NextResponse.json({ url: `${origin}/dashboard/subscription?plan=changed` });
    }

    let subscriptionId = current?.id;
    let customerId = current?.providerCustomerId;
    if (!customerId) {
      const company = membership.supplierCompany;
      const customer = await stripe.customers.create({
        name: company.tradingName ?? company.legalName,
        email: company.contactEmail,
        metadata: { supplierCompanyId: auth.companyId },
      }, { idempotencyKey: `supplier-customer:${auth.companyId}` });
      customerId = customer.id;
    }
    const saved = await runAsDatabaseWorker("stripe_billing", (tx) => tx.subscription.upsert({
      where: { supplierCompanyId: auth.companyId },
      update: { providerCustomerId: customerId, membershipPlanId: plan.id, promotionId: applicablePromotion?.id ?? null, planCode: plan.code },
      create: { supplierCompanyId: auth.companyId, providerCustomerId: customerId, membershipPlanId: plan.id, promotionId: applicablePromotion?.id ?? null, planCode: plan.code, status: "EXPIRED" },
    }));
    subscriptionId = saved.id;

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      discounts: promotionCouponId ? [{ coupon: promotionCouponId }] : undefined,
      success_url: `${origin}/dashboard/subscription?checkout=success`,
      cancel_url: `${origin}/dashboard/subscription?checkout=cancelled`,
      allow_promotion_codes: true,
      automatic_tax: { enabled: plan.taxEnabled },
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
      metadata: { kind: "supplier_membership", supplierCompanyId: auth.companyId, membershipPlanId: plan.id, planCode: plan.code, membershipPromotionId: applicablePromotion?.id ?? "" },
      subscription_data: { metadata: { supplierCompanyId: auth.companyId, membershipPlanId: plan.id, planCode: plan.code, membershipTier: plan.tier, membershipPromotionId: applicablePromotion?.id ?? "" } },
    }, { idempotencyKey: `membership-checkout:${auth.companyId}:${plan.id}:${new Date().toISOString().slice(0, 13)}` });
    if (!checkout.url) throw new Error("Stripe did not return a checkout URL");
    await runAsDatabaseWorker("stripe_billing", (tx) => tx.auditLog.create({ data: { actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "BILLING.MEMBERSHIP_CHECKOUT_CREATED", entityType: "Subscription", entityId: subscriptionId, summary: `${plan.name} checkout created`, metadata: { membershipPlanId: plan.id, tier: plan.tier, monthlyPricePence: plan.monthlyPricePence, taxEnabled: plan.taxEnabled, membershipPromotionId: applicablePromotion?.id ?? null } } }));
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    console.error("Membership checkout failed", error);
    await runAsDatabaseWorker("stripe_billing", (tx) => tx.systemEvent.create({ data: { severity: "ERROR", source: "STRIPE_CHECKOUT", code: "STRIPE_CHECKOUT_CREATION_FAILED", message: "A supplier membership checkout or plan change could not be created.", context: { supplierCompanyId: auth.companyId, errorType: error instanceof Error ? error.name : "UnknownError" } } })).catch(() => undefined);
    after(runProductionMonitoringSafely);
    return NextResponse.json({ error: error instanceof Error && error.message.includes("not configured") ? error.message : "Billing checkout could not be started" }, { status: 503 });
  }
}
