import "server-only";

import { AffiliateNotificationType, AffiliateReferralStatus, Prisma, type SubscriptionStatus } from "@prisma/client";
import type Stripe from "stripe";
import { runAsDatabaseWorker } from "@/lib/db";
import { getStripe } from "@/lib/stripe/server";

function objectId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id ?? null;
}

export function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  const parent = invoice.parent;
  if (parent?.type !== "subscription_details") return null;
  return objectId(parent.subscription_details?.subscription);
}

function paidAt(invoice: Stripe.Invoice) {
  const timestamp = invoice.status_transitions.paid_at ?? invoice.created;
  return new Date(timestamp * 1000);
}

function lineNetExcludingTax(line: Stripe.InvoiceLineItem) {
  const discounts = (line.discount_amounts ?? []).reduce((total, item) => total + item.amount, 0);
  const credits = (line.pretax_credit_amounts ?? []).reduce((total, item) => total + item.amount, 0);
  return line.subtotal - discounts - credits;
}

export function calculateEligibleInvoiceRevenue(input: {
  invoiceTotalPence: number;
  invoiceTotalExcludingTaxPence: number;
  amountPaidPence: number;
  subscriptionLinesExcludingTaxPence: number[];
}) {
  const subscriptionNet = Math.max(0, input.subscriptionLinesExcludingTaxPence.reduce((sum, amount) => sum + amount, 0));
  const invoiceNet = Math.max(0, input.invoiceTotalExcludingTaxPence);
  const eligibleBeforePayment = Math.min(subscriptionNet, invoiceNet);
  if (eligibleBeforePayment === 0 || input.amountPaidPence <= 0 || input.invoiceTotalPence <= 0) return 0;
  const paidRatio = Math.min(1, input.amountPaidPence / input.invoiceTotalPence);
  return Math.max(0, Math.round(eligibleBeforePayment * paidRatio));
}

async function fullInvoiceLines(invoiceId: string) {
  const lines: Stripe.InvoiceLineItem[] = [];
  for await (const line of getStripe().invoices.listLineItems(invoiceId, { limit: 100 })) lines.push(line);
  return lines;
}

async function successfulInvoicePayment(invoiceId: string) {
  const payments = await getStripe().invoicePayments.list({ invoice: invoiceId, status: "paid", limit: 100, expand: ["data.payment.payment_intent"] });
  const payment = payments.data.find((candidate) => candidate.status === "paid") ?? null;
  if (!payment) return { paymentId: null, chargeId: null };
  const paymentIntent = payment.payment.payment_intent;
  const charge = payment.payment.charge;
  return {
    paymentId: objectId(paymentIntent) ?? payment.id,
    chargeId: objectId(charge) ?? (typeof paymentIntent === "object" ? objectId(paymentIntent.latest_charge) : null),
  };
}

export async function recordPaidAffiliateInvoice(invoiceInput: Stripe.Invoice) {
  const stripe = getStripe();
  const invoice = await stripe.invoices.retrieve(invoiceInput.id);
  if (invoice.status !== "paid") return null;
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return null;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const lines = await fullInvoiceLines(invoice.id);
  const subscriptionLines = lines
    .filter((line) => line.parent?.type === "subscription_item_details" && objectId(line.subscription) === subscriptionId)
    .map(lineNetExcludingTax);
  const totalExcludingTax = invoice.total_excluding_tax ?? Math.max(0, invoice.total - (invoice.total_taxes ?? []).reduce((sum, tax) => sum + tax.amount, 0));
  const eligibleRevenue = calculateEligibleInvoiceRevenue({
    invoiceTotalPence: invoice.total,
    invoiceTotalExcludingTaxPence: totalExcludingTax,
    amountPaidPence: invoice.amount_paid,
    subscriptionLinesExcludingTaxPence: subscriptionLines,
  });
  const payment = await successfulInvoicePayment(invoice.id);
  const planCode = subscription.metadata.planCode || "supplier-membership";
  const result = await runAsDatabaseWorker("stripe_billing", (tx) => tx.$queryRaw<Array<{ ledger_id: string | null }>>(Prisma.sql`
    SELECT bridge_private.record_affiliate_paid_invoice(
      ${subscription.id}, ${invoice.id}, ${payment.paymentId ?? ""}, ${payment.chargeId ?? ""},
      ${planCode}, ${invoice.currency}, ${invoice.amount_paid}, ${Math.max(0, invoice.amount_paid - totalExcludingTax)},
      ${eligibleRevenue}, ${new Date(invoice.period_start * 1000)}, ${new Date(invoice.period_end * 1000)}, ${paidAt(invoice)}
    ) AS ledger_id
  `));
  return result[0]?.ledger_id ?? null;
}

function referralLifecycle(status: Stripe.Subscription.Status, cancelAtPeriodEnd: boolean): AffiliateReferralStatus {
  if (status === "canceled") return "CANCELLED";
  if (["past_due", "unpaid", "incomplete"].includes(status)) return "PAST_DUE";
  if (cancelAtPeriodEnd) return "CANCELLATION_SCHEDULED";
  return "APPROVED";
}

export async function syncAffiliateSubscriptionLifecycle(subscription: Stripe.Subscription, localStatus: SubscriptionStatus) {
  const companyId = subscription.metadata.supplierCompanyId;
  if (!companyId) return;
  await runAsDatabaseWorker("stripe_billing", async (tx) => {
    const programme = await tx.affiliateProgramme.findUniqueOrThrow({
      where: { id: "default" },
      select: { qualificationPayments: true, commissionPayments: true },
    });
    const referral = await tx.affiliateReferral.findUnique({
      where: { supplierCompanyId: companyId },
      include: { supplierCompany: { select: { legalName: true } } },
    });
    if (!referral) return;
    const ended = localStatus === "CANCELLED" || localStatus === "EXPIRED";
    const scheduled = subscription.cancel_at_period_end && !ended;
    const priorStatus = referral.status;
    const nextStatus = ended ? "CANCELLED" : referralLifecycle(subscription.status, subscription.cancel_at_period_end);
    const preserveCommissionProgress = !ended && !scheduled && !["PAST_DUE", "CANCELLATION_SCHEDULED"].includes(nextStatus);
    const progressStatus = referral.eligibleCommissionPeriodsCompleted >= programme.commissionPayments
      ? "COMMISSION_COMPLETED"
      : referral.successfulPaidPeriods > 0 && referral.successfulPaidPeriods <= programme.qualificationPayments
        ? "QUALIFICATION_MONTH"
        : referral.successfulPaidPeriods > programme.qualificationPayments
          ? "COMMISSION_ACTIVE"
          : nextStatus;
    await tx.affiliateReferral.update({
      where: { id: referral.id },
      data: {
        status: preserveCommissionProgress ? progressStatus : nextStatus,
        approvedAt: localStatus === "ACTIVE" ? referral.approvedAt ?? new Date() : referral.approvedAt,
        cancellationScheduledAt: scheduled ? new Date() : ended ? referral.cancellationScheduledAt : null,
        cancelledAt: ended ? new Date() : null,
      },
    });
    const notifications: Array<{ type: AffiliateNotificationType; title: string; body: string }> = [];
    const administratorAlerts: Array<{ fingerprint: string; title: string; body: string }> = [];
    if (scheduled && priorStatus !== "CANCELLATION_SCHEDULED") notifications.push({
      type: "CANCELLATION_SCHEDULED",
      title: "Supplier cancellation scheduled",
      body: `${referral.supplierCompany.legalName} has scheduled cancellation. Their membership remains active until the current paid period ends.`,
    });
    if (scheduled && priorStatus !== "CANCELLATION_SCHEDULED") administratorAlerts.push({
      fingerprint: `affiliate-cancellation-scheduled:${subscription.id}:${subscription.cancel_at ?? subscription.items.data[0]?.current_period_end ?? "period-end"}`,
      title: "Affiliate referral cancellation scheduled",
      body: `${referral.supplierCompany.legalName}, attributed to a Bridge AI affiliate, has scheduled membership cancellation. Review the affiliate and subscriber position before access ends.`,
    });
    if (ended && priorStatus !== "CANCELLED") notifications.push({
      type: "CANCELLATION_COMPLETED",
      title: "Referred supplier membership ended",
      body: `${referral.supplierCompany.legalName} has cancelled their Bridge AI membership. Future affiliate commission from this referral has ended.`,
    });
    if (ended && priorStatus !== "CANCELLED") administratorAlerts.push({
      fingerprint: `affiliate-cancellation-completed:${subscription.id}`,
      title: "Affiliate referral membership ended",
      body: `${referral.supplierCompany.legalName}, attributed to a Bridge AI affiliate, has ended membership. Future commission has stopped and the cancellation is recorded in the affiliate ledger history.`,
    });
    if (nextStatus === "PAST_DUE" && priorStatus !== "PAST_DUE") notifications.push({
      type: "PAYMENT_FAILED",
      title: "Supplier payment problem",
      body: `${referral.supplierCompany.legalName} has a subscription payment problem. No commission is earned unless Stripe successfully collects the invoice.`,
    });
    if (priorStatus === "PAST_DUE" && localStatus === "ACTIVE") notifications.push({
      type: "SUBSCRIPTION_RECOVERED",
      title: "Supplier subscription recovered",
      body: `${referral.supplierCompany.legalName}'s subscription is active again.`,
    });
    if (notifications.length) await tx.affiliateNotification.createMany({
      data: notifications.map((notification) => ({ affiliateId: referral.affiliateId, ...notification, actionUrl: "/affiliate/referrals" })),
    });
    if (administratorAlerts.length) await tx.productionAlert.createMany({
      data: administratorAlerts.map((alert) => ({
        ...alert,
        source: "AFFILIATE_LIFECYCLE",
        severity: "WARNING",
        actionUrl: `/admin/affiliates/${referral.affiliateId}`,
      })),
      skipDuplicates: true,
    });
    if (priorStatus !== (preserveCommissionProgress ? progressStatus : nextStatus)) {
      await tx.affiliateAuditLog.create({ data: {
        affiliateId: referral.affiliateId,
        action: "AFFILIATE.REFERRAL_SUBSCRIPTION_STATUS_CHANGED",
        entityType: "AffiliateReferral",
        entityId: referral.id,
        summary: "Referral subscription lifecycle synchronized from Stripe",
        metadata: { previousStatus: priorStatus, nextStatus: preserveCommissionProgress ? progressStatus : nextStatus, stripeSubscriptionId: subscription.id },
      } });
    }
  });
}

export async function recordAffiliatePlanChange(companyId: string, previousPlanCode: string | null, nextPlanCode: string) {
  if (!previousPlanCode || previousPlanCode === nextPlanCode) return;
  await runAsDatabaseWorker("stripe_billing", async (tx) => {
    const programme = await tx.affiliateProgramme.findUniqueOrThrow({
      where: { id: "default" },
      select: { commissionPayments: true },
    });
    const referral = await tx.affiliateReferral.findUnique({ where: { supplierCompanyId: companyId }, include: { supplierCompany: { select: { legalName: true } } } });
    if (!referral) return;
    const plans = await tx.membershipPlan.findMany({ where: { code: { in: [previousPlanCode, nextPlanCode] } }, select: { code: true, monthlyPricePence: true, name: true } });
    const previous = plans.find((plan) => plan.code === previousPlanCode); const next = plans.find((plan) => plan.code === nextPlanCode);
    const upgraded = (next?.monthlyPricePence ?? 0) > (previous?.monthlyPricePence ?? 0);
    await tx.affiliateNotification.create({ data: {
      affiliateId: referral.affiliateId,
      type: upgraded ? "PLAN_UPGRADED" : "PLAN_DOWNGRADED",
      title: upgraded ? "Referred supplier upgraded" : "Referred supplier changed plan",
      body: `${referral.supplierCompany.legalName} moved from ${previous?.name ?? previousPlanCode} to ${next?.name ?? nextPlanCode}. Commission will follow the actual net amount of the next paid invoice; the ${programme.commissionPayments}-payment clock does not reset.`,
      actionUrl: "/affiliate/referrals",
    } });
    await tx.affiliateAuditLog.create({ data: { affiliateId: referral.affiliateId, action: "AFFILIATE.REFERRAL_PLAN_CHANGED", entityType: "AffiliateReferral", entityId: referral.id, summary: "Referred supplier membership plan changed", metadata: { previousPlanCode, nextPlanCode, upgraded } } });
  });
}

export async function recordAffiliatePaymentFailure(invoiceInput: Stripe.Invoice) {
  const invoice = await getStripe().invoices.retrieve(invoiceInput.id);
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;
  await runAsDatabaseWorker("stripe_billing", async (tx) => {
    const subscription = await tx.subscription.findFirst({ where: { providerSubscriptionId: subscriptionId } });
    if (!subscription) return;
    const referral = await tx.affiliateReferral.findUnique({ where: { supplierCompanyId: subscription.supplierCompanyId }, include: { supplierCompany: { select: { legalName: true } } } });
    if (!referral) return;
    await tx.affiliateReferral.update({ where: { id: referral.id }, data: { status: "PAST_DUE", lastPaymentFailedAt: new Date() } });
    await tx.affiliateNotification.create({ data: {
      affiliateId: referral.affiliateId,
      type: "PAYMENT_FAILED",
      title: "Supplier payment failed",
      body: `${referral.supplierCompany.legalName}'s payment failed. This invoice has generated no affiliate commission.`,
      actionUrl: "/affiliate/referrals",
    } });
    await tx.affiliateAuditLog.create({ data: {
      affiliateId: referral.affiliateId,
      action: "AFFILIATE.INVOICE_PAYMENT_FAILED",
      entityType: "StripeInvoice",
      entityId: invoice.id,
      summary: "Failed Stripe invoice recorded without commission",
      metadata: { stripeSubscriptionId: subscriptionId },
    } });
  });
}

async function sourceCommissionForPayment(paymentIntentId: string | null, chargeId: string | null) {
  if (!paymentIntentId && !chargeId) return null;
  return runAsDatabaseWorker("stripe_billing", (tx) => tx.affiliateCommission.findFirst({
    where: { OR: [paymentIntentId ? { stripePaymentId: paymentIntentId } : undefined, chargeId ? { stripeChargeId: chargeId } : undefined].filter(Boolean) as Prisma.AffiliateCommissionWhereInput[] },
    include: { payoutItem: true, adjustments: true, supplierCompany: { select: { legalName: true } } },
    orderBy: { earnedAt: "desc" },
  }));
}

export async function recordAffiliateRefund(refundInput: Stripe.Refund) {
  const stripe = getStripe();
  const refund = await stripe.refunds.retrieve(refundInput.id);
  if (refund.status === "failed" || refund.amount <= 0) return;
  const paymentIntentId = objectId(refund.payment_intent);
  const chargeId = objectId(refund.charge);
  const source = await sourceCommissionForPayment(paymentIntentId, chargeId);
  if (!source || source.entryType !== "INVOICE" || source.commissionAmountPence <= 0) return;
  await runAsDatabaseWorker("stripe_billing", async (tx) => {
    if (await tx.affiliateCommission.findUnique({ where: { externalLedgerKey: `refund:${refund.id}` } })) return;
    const alreadyAdjusted = source.adjustments.reduce((sum, entry) => sum + Math.abs(entry.commissionAmountPence), 0);
    const adjustment = Math.min(Math.max(0, source.commissionAmountPence - alreadyAdjusted), Math.round(source.commissionAmountPence * (refund.amount / source.billingAmountPence)));
    const paid = Boolean(source.paidAt || source.payoutItem);
    await tx.affiliateCommission.create({ data: {
      externalLedgerKey: `refund:${refund.id}`,
      entryType: "REFUND_ADJUSTMENT",
      affiliateId: source.affiliateId,
      referralId: source.referralId,
      supplierCompanyId: source.supplierCompanyId,
      subscriptionId: source.subscriptionId,
      membershipPlanId: source.membershipPlanId,
      stripeInvoiceId: source.stripeInvoiceId,
      stripePaymentId: paymentIntentId,
      stripeChargeId: chargeId,
      stripeRefundId: refund.id,
      sourceCommissionId: source.id,
      planCode: source.planCode,
      currency: refund.currency.toUpperCase(),
      billingAmountPence: refund.amount,
      vatAmountPence: 0,
      eligibleRevenuePence: 0,
      commissionRateBps: source.commissionRateBps,
      commissionAmountPence: -adjustment,
      status: "ADJUSTMENT_PENDING",
      earnedAt: new Date(refund.created * 1000),
      validationAt: new Date(),
    } });
    await tx.affiliateNotification.create({ data: {
      affiliateId: source.affiliateId,
      type: "COMMISSION_REVERSED",
      title: "Commission adjusted after refund",
      body: `${source.supplierCompany.legalName}'s refunded subscription payment has been reflected in your commission ledger.`,
      actionUrl: "/affiliate/earnings",
    } });
    await tx.affiliateAuditLog.create({ data: {
      affiliateId: source.affiliateId,
      action: "AFFILIATE.COMMISSION_REFUND_RECORDED",
      entityType: "AffiliateCommission",
      entityId: source.id,
      summary: "Stripe refund recorded without rewriting the original ledger amount",
      metadata: { stripeRefundId: refund.id, refundAmountPence: refund.amount, commissionAdjustmentPence: -adjustment, originalPaidOut: paid },
    } });
  });
}

export async function recordAffiliateDispute(disputeInput: Stripe.Dispute) {
  const stripe = getStripe();
  const dispute = await stripe.disputes.retrieve(disputeInput.id);
  const source = await sourceCommissionForPayment(objectId(dispute.payment_intent), objectId(dispute.charge));
  if (!source || source.entryType !== "INVOICE" || source.commissionAmountPence <= 0) return;
  await runAsDatabaseWorker("stripe_billing", async (tx) => {
    if (await tx.affiliateCommission.findUnique({ where: { externalLedgerKey: `dispute:${dispute.id}` } })) return;
    const paid = Boolean(source.paidAt || source.payoutItem);
    const alreadyAdjusted = source.adjustments.reduce((sum, entry) => sum + Math.abs(entry.commissionAmountPence), 0);
    const adjustment = Math.max(0, source.commissionAmountPence - alreadyAdjusted);
    await tx.affiliateCommission.create({ data: {
      externalLedgerKey: `dispute:${dispute.id}`,
      entryType: "DISPUTE_ADJUSTMENT",
      affiliateId: source.affiliateId,
      referralId: source.referralId,
      supplierCompanyId: source.supplierCompanyId,
      subscriptionId: source.subscriptionId,
      membershipPlanId: source.membershipPlanId,
      stripeInvoiceId: source.stripeInvoiceId,
      stripePaymentId: objectId(dispute.payment_intent),
      stripeChargeId: objectId(dispute.charge),
      stripeDisputeId: dispute.id,
      sourceCommissionId: source.id,
      planCode: source.planCode,
      currency: dispute.currency.toUpperCase(),
      billingAmountPence: dispute.amount,
      vatAmountPence: 0,
      eligibleRevenuePence: 0,
      commissionRateBps: source.commissionRateBps,
      commissionAmountPence: -adjustment,
      status: "ADJUSTMENT_PENDING",
      earnedAt: new Date(dispute.created * 1000),
      validationAt: new Date(),
    } });
    await tx.affiliateAuditLog.create({ data: {
      affiliateId: source.affiliateId,
      action: "AFFILIATE.COMMISSION_DISPUTE_RECORDED",
      entityType: "AffiliateCommission",
      entityId: source.id,
      summary: "Stripe dispute recorded without rewriting the original ledger amount",
      metadata: { stripeDisputeId: dispute.id, originalPaidOut: paid },
    } });
  });
}
