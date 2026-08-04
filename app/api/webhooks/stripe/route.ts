import { after, NextResponse } from "next/server";
import { Prisma, type SubscriptionStatus } from "@prisma/client";
import type Stripe from "stripe";
import { trustedPrisma } from "@/lib/db";
import { getStripe, stripeWebhookSecret } from "@/lib/stripe/server";
import { unlockPaidQuotation } from "@/lib/quotes/selection";
import { enqueueContactUnlock, processWhatsAppJobs } from "@/lib/whatsapp/processor";

export const runtime = "nodejs";
const PROVIDER = "STRIPE";

function localSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  if (status === "trialing") return "TRIALING";
  if (status === "active") return "ACTIVE";
  if (status === "past_due" || status === "unpaid" || status === "incomplete") return "PAST_DUE";
  if (status === "paused") return "PAUSED";
  if (status === "canceled") return "CANCELLED";
  return "EXPIRED";
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const companyId = subscription.metadata.supplierCompanyId;
  if (!companyId) throw new Error("STRIPE_SUBSCRIPTION_COMPANY_MISSING");
  const item = subscription.items.data[0];
  await trustedPrisma.subscription.upsert({
    where: { supplierCompanyId: companyId },
    update: {
      providerCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      providerSubscriptionId: subscription.id,
      planCode: subscription.metadata.planCode || "bridge-ai-monthly",
      status: localSubscriptionStatus(subscription.status),
      currentPeriodStart: item?.current_period_start ? new Date(item.current_period_start * 1000) : null,
      currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
    create: {
      supplierCompanyId: companyId,
      providerCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      providerSubscriptionId: subscription.id,
      planCode: subscription.metadata.planCode || "bridge-ai-monthly",
      status: localSubscriptionStatus(subscription.status),
      currentPeriodStart: item?.current_period_start ? new Date(item.current_period_start * 1000) : null,
      currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  });
  await trustedPrisma.auditLog.create({ data: {
    supplierCompanyId: companyId,
    action: "BILLING.SUBSCRIPTION_SYNCED",
    entityType: "Subscription",
    entityId: subscription.id,
    summary: `Stripe membership state synchronized as ${subscription.status}`,
    metadata: { stripeStatus: subscription.status },
  } });
}

async function processEvent(event: Stripe.Event) {
  if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    await syncSubscription(event.data.object as Stripe.Subscription);
    return;
  }
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) return;
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.kind === "supplier_membership" && typeof session.subscription === "string") {
    const subscription = await getStripe().subscriptions.retrieve(session.subscription);
    await syncSubscription(subscription);
    return;
  }
  if (session.metadata?.kind === "success_fee" && session.payment_status === "paid") {
    const successFeeId = session.metadata.successFeeId;
    const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!successFeeId || !paymentIntentId) throw new Error("STRIPE_SUCCESS_FEE_METADATA_MISSING");
    const paidAt = new Date(event.created * 1000);
    try {
      await unlockPaidQuotation({ successFeeId, paymentIntentId, paidAt });
      after(async () => {
        try {
          const job = await enqueueContactUnlock(successFeeId);
          if (job) await processWhatsAppJobs({ limit: 5 });
        } catch {
          console.error("Customer contact-unlock scheduling failed", { successFeeId });
        }
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "SUCCESS_FEE_PAID_AFTER_DEADLINE") throw error;
      const fee = await trustedPrisma.supplierSuccessFee.update({
        where: { id: successFeeId },
        data: { status: "EXPIRED", expiredAt: paidAt, providerPaymentIntentId: paymentIntentId },
      });
      await trustedPrisma.supplierQuotation.updateMany({ where: { id: fee.quotationId, status: "SELECTED_PENDING_PAYMENT" }, data: { status: "EXPIRED" } });
      await trustedPrisma.auditLog.create({ data: { supplierCompanyId: fee.supplierCompanyId, action: "BILLING.LATE_SUCCESS_FEE_CAPTURED", entityType: "SupplierSuccessFee", entityId: fee.id, summary: "Late payment captured; contact access remained locked pending refund review", metadata: { paymentIntentId } } });
      await trustedPrisma.systemEvent.create({ data: {
        severity: "CRITICAL",
        source: "STRIPE_WEBHOOK",
        code: "SUCCESS_FEE_CAPTURED_AFTER_DEADLINE",
        message: "A £25 payment was captured after the supplier unlock deadline; contact remained locked and a refund review is required.",
        context: { successFeeId, paymentIntentId, supplierCompanyId: fee.supplierCompanyId },
      } });
    }
  }
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(await request.text(), signature, stripeWebhookSecret());
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    const existing = await trustedPrisma.webhookEvent.findUnique({ where: { provider_externalEventId: { provider: PROVIDER, externalEventId: event.id } } });
    if (existing?.processedAt) return NextResponse.json({ received: true, duplicate: true });
    const stored = existing ? await trustedPrisma.webhookEvent.update({ where: { id: existing.id }, data: { retryCount: { increment: 1 }, failedAt: null, failureReason: null } }) : await trustedPrisma.webhookEvent.create({ data: {
      provider: PROVIDER,
      externalEventId: event.id,
      eventType: event.type,
      payload: { livemode: event.livemode, apiVersion: event.api_version ?? null, objectId: "id" in event.data.object ? event.data.object.id : null } as Prisma.InputJsonValue,
    } });
    await processEvent(event);
    await trustedPrisma.webhookEvent.update({ where: { id: stored.id }, data: { processedAt: new Date() } });
    return NextResponse.json({ received: true, duplicate: false });
  } catch (error) {
    console.error("Verified Stripe webhook processing failed", error);
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown processing failure";
    await trustedPrisma.webhookEvent.upsert({
      where: { provider_externalEventId: { provider: PROVIDER, externalEventId: event.id } },
      update: { failedAt: new Date(), failureReason: message, retryCount: { increment: 1 } },
      create: { provider: PROVIDER, externalEventId: event.id, eventType: event.type, payload: { livemode: event.livemode } as Prisma.InputJsonValue, failedAt: new Date(), failureReason: message },
    }).catch(() => undefined);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
