import { after, NextResponse } from "next/server";
import { requireSupplierApi } from "@/lib/auth/api";
import { prisma, runAsDatabaseWorker } from "@/lib/db";
import { applicationOrigin } from "@/lib/config";
import { getStripe, introductoryMembershipPriceId } from "@/lib/stripe/server";
import { FOUNDING_PLAN_CODE, isFoundingSupplier } from "@/lib/billing/pricing";
import { runProductionMonitoringSafely } from "@/lib/monitoring/operational-alerts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const membership = auth.session.user.memberships.find((item) => item.supplierCompanyId === auth.companyId);
  if (!membership || !["OWNER", "MANAGER"].includes(membership.role)) return NextResponse.json({ error: "Owner or manager access required" }, { status: 403 });
  if (membership.supplierCompany.status !== "APPROVED") return NextResponse.json({ error: "Supplier approval is required before subscribing" }, { status: 409 });
  if (!isFoundingSupplier(membership.supplierCompany.foundingMemberNumber)) return NextResponse.json({ error: "The first 100 approved supplier places have been allocated" }, { status: 409 });
  try {
    const stripe = getStripe();
    const current = await prisma.subscription.findUnique({ where: { supplierCompanyId: auth.companyId } });
    if (current?.status === "ACTIVE") return NextResponse.json({ error: "This membership is already active" }, { status: 409 });
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
      const saved = await runAsDatabaseWorker("stripe_billing", (tx) => tx.subscription.upsert({
        where: { supplierCompanyId: auth.companyId },
        update: { providerCustomerId: customerId, planCode: FOUNDING_PLAN_CODE },
        create: { supplierCompanyId: auth.companyId, providerCustomerId: customerId, planCode: FOUNDING_PLAN_CODE, status: "EXPIRED" },
      }));
      subscriptionId = saved.id;
    }
    const origin = applicationOrigin(request.url);
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: introductoryMembershipPriceId(), quantity: 1 }],
      success_url: `${origin}/dashboard/subscription?checkout=success`,
      cancel_url: `${origin}/dashboard/subscription?checkout=cancelled`,
      allow_promotion_codes: false,
      automatic_tax: { enabled: false },
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
      metadata: { kind: "supplier_membership", supplierCompanyId: auth.companyId, planCode: FOUNDING_PLAN_CODE },
      subscription_data: { metadata: { supplierCompanyId: auth.companyId, planCode: FOUNDING_PLAN_CODE, introductoryMonths: "6" } },
    }, { idempotencyKey: `membership-checkout:${auth.companyId}:${new Date().toISOString().slice(0, 13)}` });
    if (!checkout.url) throw new Error("Stripe did not return a checkout URL");
    await runAsDatabaseWorker("stripe_billing", (tx) => tx.auditLog.create({ data: { actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "BILLING.MEMBERSHIP_CHECKOUT_CREATED", entityType: "Subscription", entityId: subscriptionId, summary: "Founding supplier membership checkout created at £29.99 for six months", metadata: { foundingMemberNumber: membership.supplierCompany.foundingMemberNumber, planCode: FOUNDING_PLAN_CODE, vatCharged: false } } }));
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    console.error("Membership checkout failed", error);
    await runAsDatabaseWorker("stripe_billing", (tx) => tx.systemEvent.create({ data: {
      severity: "ERROR",
      source: "STRIPE_CHECKOUT",
      code: "STRIPE_CHECKOUT_CREATION_FAILED",
      message: "A supplier membership checkout could not be created.",
      context: {
        supplierCompanyId: auth.companyId,
        errorType: error instanceof Error ? error.name : "UnknownError",
      },
    } })).catch(() => undefined);
    after(runProductionMonitoringSafely);
    return NextResponse.json({ error: error instanceof Error && error.message.includes("not configured") ? error.message : "Billing checkout could not be started" }, { status: 503 });
  }
}
