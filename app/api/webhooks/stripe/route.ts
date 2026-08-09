import { after, NextResponse } from "next/server";
import { Prisma, type SubscriptionStatus } from "@prisma/client";
import type Stripe from "stripe";
import { runAsDatabaseWorker } from "@/lib/db";
import { getStripe, introductoryMembershipPriceId, standardMembershipPriceId, stripeWebhookSecret } from "@/lib/stripe/server";
import { FOUNDING_PLAN_CODE, INTRODUCTORY_MONTHS } from "@/lib/billing/pricing";
import { runProductionMonitoringSafely } from "@/lib/monitoring/operational-alerts";
import {
  invoiceSubscriptionId,
  recordAffiliateDispute,
  recordAffiliatePaymentFailure,
  recordAffiliateRefund,
  recordAffiliatePlanChange,
  recordPaidAffiliateInvoice,
  syncAffiliateSubscriptionLifecycle,
} from "@/lib/affiliates/stripe-ledger";
import { processAffiliateEmailsSafely } from "@/lib/affiliates/email-worker";

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
  const membershipPlan = subscription.metadata.membershipPlanId
    ? await runAsDatabaseWorker("stripe_billing", (tx) => tx.membershipPlan.findUnique({ where: { id: subscription.metadata.membershipPlanId } }))
    : subscription.metadata.planCode
      ? await runAsDatabaseWorker("stripe_billing", (tx) => tx.membershipPlan.findUnique({ where: { code: subscription.metadata.planCode } }))
      : null;
  const membershipPromotion = subscription.metadata.membershipPromotionId
    ? await runAsDatabaseWorker("stripe_billing", (tx) => tx.membershipPromotion.findUnique({ where: { id: subscription.metadata.membershipPromotionId } }))
    : null;
  let previousPlanCode: string | null = null;
  await runAsDatabaseWorker("stripe_billing", async (tx) => {
    const current = await tx.subscription.findUnique({ where: { supplierCompanyId: companyId } });
    previousPlanCode = current?.planCode ?? null;
    const complimentaryActive = current?.accessSource === "COMPLIMENTARY"
      && current.status === "ACTIVE"
      && Boolean(current.currentPeriodEnd && current.currentPeriodEnd > new Date());
    if (complimentaryActive) {
      await tx.auditLog.create({ data: {
        supplierCompanyId: companyId,
        action: "BILLING.STRIPE_SYNC_DEFERRED",
        entityType: "Subscription",
        entityId: subscription.id,
        summary: "Stripe membership update did not replace an active administrator-granted complimentary period",
        metadata: { stripeStatus: subscription.status, complimentaryExpiresAt: current.currentPeriodEnd?.toISOString() },
      } });
      return;
    }
    await tx.subscription.upsert({
      where: { supplierCompanyId: companyId },
      update: {
        provider: "stripe",
        providerCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
        providerSubscriptionId: subscription.id,
        providerScheduleId: typeof subscription.schedule === "string" ? subscription.schedule : subscription.schedule?.id ?? null,
        planCode: subscription.metadata.planCode || FOUNDING_PLAN_CODE,
        membershipPlanId: membershipPlan?.id ?? current?.membershipPlanId ?? null,
        promotionId: membershipPromotion?.id ?? null,
        status: localSubscriptionStatus(subscription.status),
        accessSource: "STRIPE",
        currentPeriodStart: item?.current_period_start ? new Date(item.current_period_start * 1000) : null,
        currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        complimentaryReason: null,
        complimentaryGrantedAt: null,
        complimentaryGrantedById: null,
        complimentaryRevokedAt: null,
        complimentaryRevokedById: null,
        complimentaryRevocationReason: null,
      },
      create: {
        supplierCompanyId: companyId,
        provider: "stripe",
        providerCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
        providerSubscriptionId: subscription.id,
        providerScheduleId: typeof subscription.schedule === "string" ? subscription.schedule : subscription.schedule?.id ?? null,
        planCode: subscription.metadata.planCode || FOUNDING_PLAN_CODE,
        membershipPlanId: membershipPlan?.id ?? null,
        promotionId: membershipPromotion?.id ?? null,
        status: localSubscriptionStatus(subscription.status),
        accessSource: "STRIPE",
        currentPeriodStart: item?.current_period_start ? new Date(item.current_period_start * 1000) : null,
        currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });
    await tx.auditLog.create({ data: {
      supplierCompanyId: companyId,
      action: "BILLING.SUBSCRIPTION_SYNCED",
      entityType: "Subscription",
      entityId: subscription.id,
      summary: `Stripe membership state synchronized as ${subscription.status}`,
      metadata: { stripeStatus: subscription.status, membershipPlanId: membershipPlan?.id ?? null, membershipTier: membershipPlan?.tier ?? null, membershipPromotionId: membershipPromotion?.id ?? null },
    } });
  });
  await syncAffiliateSubscriptionLifecycle(subscription, localSubscriptionStatus(subscription.status));
  await recordAffiliatePlanChange(companyId, previousPlanCode, subscription.metadata.planCode || FOUNDING_PLAN_CODE);
}

async function ensureFoundingPriceSchedule(subscription: Stripe.Subscription) {
  if (subscription.metadata.planCode !== FOUNDING_PLAN_CODE) return null;
  const stripe = getStripe();
  let schedule = typeof subscription.schedule === "string"
    ? await stripe.subscriptionSchedules.retrieve(subscription.schedule)
    : subscription.schedule;
  if (!schedule) {
    schedule = await stripe.subscriptionSchedules.create({ from_subscription: subscription.id });
  }
  if (schedule.metadata?.bridgeAiPricingVersion === "founding-v1") return schedule;
  const currentStart = schedule.current_phase?.start_date ?? subscription.items.data[0]?.current_period_start;
  if (!currentStart) throw new Error("STRIPE_SUBSCRIPTION_PERIOD_MISSING");
  return stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    metadata: {
      bridgeAiPricingVersion: "founding-v1",
      supplierCompanyId: subscription.metadata.supplierCompanyId,
    },
    phases: [
      {
        start_date: currentStart,
        duration: { interval: "month", interval_count: INTRODUCTORY_MONTHS },
        items: [{ price: introductoryMembershipPriceId(), quantity: 1 }],
        proration_behavior: "none",
        metadata: { supplierCompanyId: subscription.metadata.supplierCompanyId, planCode: FOUNDING_PLAN_CODE, pricingPhase: "introductory" },
      },
      {
        items: [{ price: standardMembershipPriceId(), quantity: 1 }],
        proration_behavior: "none",
        metadata: { supplierCompanyId: subscription.metadata.supplierCompanyId, planCode: FOUNDING_PLAN_CODE, pricingPhase: "standard" },
      },
    ],
  });
}

async function processEvent(event: Stripe.Event) {
  if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    const incoming = event.data.object as Stripe.Subscription;
    await syncSubscription(await getStripe().subscriptions.retrieve(incoming.id));
    return;
  }
  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (subscriptionId) await syncSubscription(await getStripe().subscriptions.retrieve(subscriptionId));
    await recordPaidAffiliateInvoice(invoice);
    return;
  }
  if (event.type === "invoice.payment_failed") {
    await recordAffiliatePaymentFailure(event.data.object as Stripe.Invoice);
    return;
  }
  if (event.type === "refund.created") {
    await recordAffiliateRefund(event.data.object as Stripe.Refund);
    return;
  }
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    for (const refund of charge.refunds?.data ?? []) await recordAffiliateRefund(refund);
    return;
  }
  if (event.type === "charge.dispute.created") {
    await recordAffiliateDispute(event.data.object as Stripe.Dispute);
    return;
  }
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) return;
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.kind === "supplier_membership" && typeof session.subscription === "string") {
    let subscription = await getStripe().subscriptions.retrieve(session.subscription);
    const schedule = await ensureFoundingPriceSchedule(subscription);
    if (schedule) subscription = await getStripe().subscriptions.retrieve(session.subscription);
    await syncSubscription(subscription);
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
    const existing = await runAsDatabaseWorker("stripe_billing", (tx) => tx.webhookEvent.findUnique({ where: { provider_externalEventId: { provider: PROVIDER, externalEventId: event.id } } }));
    if (existing?.processedAt) return NextResponse.json({ received: true, duplicate: true });
    const stored = await runAsDatabaseWorker("stripe_billing", (tx) => existing ? tx.webhookEvent.update({ where: { id: existing.id }, data: { retryCount: { increment: 1 }, failedAt: null, failureReason: null } }) : tx.webhookEvent.create({ data: {
      provider: PROVIDER,
      externalEventId: event.id,
      eventType: event.type,
      payload: { livemode: event.livemode, apiVersion: event.api_version ?? null, objectId: "id" in event.data.object ? event.data.object.id : null } as Prisma.InputJsonValue,
    } }));
    await processEvent(event);
    await runAsDatabaseWorker("stripe_billing", (tx) => tx.webhookEvent.update({ where: { id: stored.id }, data: { processedAt: new Date() } }));
    after(processAffiliateEmailsSafely);
    return NextResponse.json({ received: true, duplicate: false });
  } catch (error) {
    console.error("Verified Stripe webhook processing failed", error);
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown processing failure";
    await runAsDatabaseWorker("stripe_billing", async (tx) => {
      await tx.webhookEvent.upsert({
        where: { provider_externalEventId: { provider: PROVIDER, externalEventId: event.id } },
        update: { failedAt: new Date(), failureReason: message, retryCount: { increment: 1 } },
        create: { provider: PROVIDER, externalEventId: event.id, eventType: event.type, payload: { livemode: event.livemode } as Prisma.InputJsonValue, failedAt: new Date(), failureReason: message },
      });
      await tx.systemEvent.create({
        data: {
          severity: "ERROR",
          source: "STRIPE_WEBHOOK",
          code: "STRIPE_WEBHOOK_PROCESSING_FAILED",
          message: "A verified Stripe webhook could not be processed and requires provider redelivery.",
          context: { externalEventId: event.id, eventType: event.type, failureCode: message },
        },
      });
    }).catch(() => undefined);
    after(runProductionMonitoringSafely);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
