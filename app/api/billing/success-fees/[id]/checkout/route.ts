import { NextResponse } from "next/server";
import { requireSupplierApi } from "@/lib/auth/api";
import { prisma, trustedPrisma } from "@/lib/db";
import { applicationOrigin } from "@/lib/config";
import { getStripe } from "@/lib/stripe/server";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const fee = await prisma.supplierSuccessFee.findFirst({
    where: { id, supplierCompanyId: auth.companyId },
    include: { quotation: { include: { quoteRequest: true } } },
  });
  if (!fee) return NextResponse.json({ error: "Success fee not found" }, { status: 404 });
  if (!["PENDING", "CHECKOUT_CREATED"].includes(fee.status) || fee.quotation.status !== "SELECTED_PENDING_PAYMENT") return NextResponse.json({ error: "This success fee is no longer payable" }, { status: 409 });
  if (fee.paymentDueAt <= new Date()) return NextResponse.json({ error: "The payment window has closed" }, { status: 409 });
  try {
    const subscription = await prisma.subscription.findUnique({ where: { supplierCompanyId: auth.companyId } });
    if (!subscription?.providerCustomerId) return NextResponse.json({ error: "A billing customer must be linked first" }, { status: 409 });
    const attempt = fee.checkoutAttempt + 1;
    const origin = applicationOrigin(request.url);
    const nowSeconds = Math.floor(Date.now() / 1000);
    // Stripe requires Checkout sessions to live for at least 30 minutes. The
    // webhook still refuses a payment recorded after Bridge AI's earlier due time.
    const expiresAt = Math.max(nowSeconds + 1800, Math.min(Math.floor(fee.paymentDueAt.getTime() / 1000), nowSeconds + 86400));
    const checkout = await getStripe().checkout.sessions.create({
      mode: "payment",
      customer: subscription.providerCustomerId,
      line_items: [{ price_data: { currency: "gbp", unit_amount: 2500, product_data: { name: `Bridge AI success fee — ${fee.quotation.quoteRequest.reference}` } }, quantity: 1 }],
      payment_method_types: ["card"],
      success_url: `${origin}/dashboard/requests/${fee.quotation.quoteRequest.reference}?payment=processing`,
      cancel_url: `${origin}/dashboard/requests/${fee.quotation.quoteRequest.reference}?payment=cancelled`,
      expires_at: expiresAt,
      metadata: { kind: "success_fee", successFeeId: fee.id, supplierCompanyId: auth.companyId, quotationId: fee.quotationId },
    }, { idempotencyKey: `success-fee:${fee.id}:attempt:${attempt}` });
    if (!checkout.url) throw new Error("Stripe did not return a checkout URL");
    await trustedPrisma.supplierSuccessFee.update({ where: { id: fee.id }, data: { status: "CHECKOUT_CREATED", providerCheckoutSessionId: checkout.id, checkoutAttempt: attempt } });
    await trustedPrisma.auditLog.create({ data: { actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "BILLING.SUCCESS_FEE_CHECKOUT_CREATED", entityType: "SupplierSuccessFee", entityId: fee.id, summary: "£25 success-fee checkout created", metadata: { checkoutAttempt: attempt } } });
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    console.error("Success-fee checkout failed", error);
    return NextResponse.json({ error: "Payment checkout could not be started" }, { status: 503 });
  }
}
