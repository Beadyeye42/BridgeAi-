import { NextResponse } from "next/server";
import { requireSupplierApi } from "@/lib/auth/api";
import { prisma, trustedPrisma } from "@/lib/db";
import { applicationOrigin } from "@/lib/config";
import { getStripe, membershipPriceId } from "@/lib/stripe/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const membership = auth.session.user.memberships.find((item) => item.supplierCompanyId === auth.companyId);
  if (!membership || !["OWNER", "MANAGER"].includes(membership.role)) return NextResponse.json({ error: "Owner or manager access required" }, { status: 403 });
  if (membership.supplierCompany.status !== "APPROVED") return NextResponse.json({ error: "Supplier approval is required before subscribing" }, { status: 409 });
  try {
    const stripe = getStripe();
    const current = await prisma.subscription.findUnique({ where: { supplierCompanyId: auth.companyId } });
    if (current?.status === "ACTIVE") return NextResponse.json({ error: "This membership is already active" }, { status: 409 });
    let customerId = current?.providerCustomerId;
    if (!customerId) {
      const company = membership.supplierCompany;
      const customer = await stripe.customers.create({
        name: company.tradingName ?? company.legalName,
        email: company.contactEmail,
        metadata: { supplierCompanyId: auth.companyId },
      }, { idempotencyKey: `supplier-customer:${auth.companyId}` });
      customerId = customer.id;
      await trustedPrisma.subscription.upsert({
        where: { supplierCompanyId: auth.companyId },
        update: { providerCustomerId: customerId, planCode: "bridge-ai-monthly" },
        create: { supplierCompanyId: auth.companyId, providerCustomerId: customerId, planCode: "bridge-ai-monthly", status: "EXPIRED" },
      });
    }
    const origin = applicationOrigin(request.url);
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: membershipPriceId(), quantity: 1 }],
      success_url: `${origin}/dashboard/subscription?checkout=success`,
      cancel_url: `${origin}/dashboard/subscription?checkout=cancelled`,
      allow_promotion_codes: false,
      metadata: { kind: "supplier_membership", supplierCompanyId: auth.companyId },
      subscription_data: { metadata: { supplierCompanyId: auth.companyId, planCode: "bridge-ai-monthly" } },
    }, { idempotencyKey: `membership-checkout:${auth.companyId}:${new Date().toISOString().slice(0, 13)}` });
    if (!checkout.url) throw new Error("Stripe did not return a checkout URL");
    await trustedPrisma.auditLog.create({ data: { actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "BILLING.MEMBERSHIP_CHECKOUT_CREATED", entityType: "Subscription", entityId: current?.id, summary: "Supplier membership checkout created" } });
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    console.error("Membership checkout failed", error);
    return NextResponse.json({ error: error instanceof Error && error.message.includes("not configured") ? error.message : "Billing checkout could not be started" }, { status: 503 });
  }
}
