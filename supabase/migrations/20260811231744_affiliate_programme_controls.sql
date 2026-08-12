-- Make the administrator-controlled affiliate qualification, commission and
-- validation periods authoritative in the invoice ledger worker.
CREATE OR REPLACE FUNCTION bridge_private.record_affiliate_paid_invoice(
  provider_subscription_id text,
  stripe_invoice_id text,
  stripe_payment_id text,
  stripe_charge_id text,
  paid_plan_code text,
  paid_currency text,
  billing_amount_pence integer,
  vat_amount_pence integer,
  eligible_revenue_pence integer,
  billing_period_start timestamptz,
  billing_period_end timestamptz,
  invoice_paid_at timestamptz
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  local_subscription bridge_ai."Subscription"%ROWTYPE;
  referral bridge_ai.affiliate_referrals%ROWTYPE;
  programme bridge_ai.affiliate_programme%ROWTYPE;
  affiliate_rate integer;
  paid_period integer;
  commission_sequence integer;
  commission_amount integer := 0;
  ledger_status bridge_ai."AffiliateCommissionStatus";
  ledger_id text;
  validation_at timestamptz;
  progress_eligible boolean;
BEGIN
  IF session_user <> 'bridge_ai_app' OR coalesce(current_setting('bridge_ai.worker_context', true), '') <> 'stripe_billing' THEN
    RAISE EXCEPTION 'trusted Stripe worker required' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO ledger_id FROM bridge_ai.affiliate_commissions
  WHERE "externalLedgerKey" = 'invoice:' || stripe_invoice_id;
  IF ledger_id IS NOT NULL THEN RETURN ledger_id; END IF;

  SELECT * INTO local_subscription FROM bridge_ai."Subscription"
  WHERE "providerSubscriptionId" = provider_subscription_id FOR SHARE;
  IF local_subscription.id IS NULL THEN
    RAISE EXCEPTION 'local subscription missing for paid invoice' USING ERRCODE = '23503';
  END IF;
  SELECT * INTO referral FROM bridge_ai.affiliate_referrals
  WHERE "supplierCompanyId" = local_subscription."supplierCompanyId" FOR UPDATE;
  IF referral.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO programme FROM bridge_ai.affiliate_programme WHERE id = 'default';
  SELECT coalesce(affiliate."commissionRateBps", programme."commissionRateBps") INTO affiliate_rate
  FROM bridge_ai.affiliates affiliate WHERE affiliate.id = referral."affiliateId" AND affiliate.status = 'ACTIVE';

  progress_eligible := programme.enabled AND affiliate_rate IS NOT NULL
    AND billing_amount_pence > 0 AND eligible_revenue_pence > 0
    AND (referral."cancelledAt" IS NULL OR invoice_paid_at < referral."cancelledAt");

  IF progress_eligible THEN
    paid_period := referral."successfulPaidPeriods" + 1;
    IF paid_period <= programme."qualificationPayments" THEN
      commission_sequence := 0;
      ledger_status := 'QUALIFICATION';
    ELSIF paid_period <= programme."qualificationPayments" + programme."commissionPayments" THEN
      commission_sequence := paid_period - programme."qualificationPayments";
      commission_amount := ((eligible_revenue_pence::bigint * affiliate_rate + 5000) / 10000)::integer;
      ledger_status := 'PENDING';
      validation_at := invoice_paid_at + make_interval(days => programme."validationDays");
    ELSE
      commission_sequence := NULL;
      ledger_status := 'NOT_ELIGIBLE';
    END IF;
  ELSE
    paid_period := NULL;
    commission_sequence := NULL;
    ledger_status := 'NOT_ELIGIBLE';
    affiliate_rate := coalesce(affiliate_rate, programme."commissionRateBps");
  END IF;

  ledger_id := 'affiliate_commission_' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO bridge_ai.affiliate_commissions (
    id, "externalLedgerKey", "entryType", "affiliateId", "referralId", "supplierCompanyId",
    "subscriptionId", "membershipPlanId", "stripeInvoiceId", "stripePaymentId", "stripeChargeId",
    "planCode", currency, "billingAmountPence", "vatAmountPence", "eligibleRevenuePence",
    "commissionRateBps", "commissionAmountPence", "paidBillingPeriod", "commissionSequence",
    "billingPeriodStart", "billingPeriodEnd", status, "earnedAt", "validationAt", "createdAt"
  ) VALUES (
    ledger_id, 'invoice:' || stripe_invoice_id, 'INVOICE', referral."affiliateId", referral.id,
    referral."supplierCompanyId", local_subscription.id, local_subscription."membershipPlanId",
    stripe_invoice_id, nullif(stripe_payment_id,''), nullif(stripe_charge_id,''), paid_plan_code,
    upper(paid_currency), billing_amount_pence, vat_amount_pence, eligible_revenue_pence,
    affiliate_rate, commission_amount, paid_period, commission_sequence, billing_period_start,
    billing_period_end, ledger_status, invoice_paid_at, validation_at, now()
  );

  IF progress_eligible THEN
    UPDATE bridge_ai.affiliate_referrals SET
      "successfulPaidPeriods" = paid_period,
      "eligibleCommissionPeriodsCompleted" = CASE WHEN commission_sequence BETWEEN 1 AND programme."commissionPayments"
        THEN commission_sequence ELSE "eligibleCommissionPeriodsCompleted" END,
      "firstPaidAt" = coalesce("firstPaidAt", invoice_paid_at),
      "qualificationCompletedAt" = CASE WHEN paid_period >= programme."qualificationPayments"
        THEN coalesce("qualificationCompletedAt", invoice_paid_at) ELSE "qualificationCompletedAt" END,
      "completedAt" = CASE WHEN commission_sequence = programme."commissionPayments" THEN invoice_paid_at ELSE "completedAt" END,
      status = CASE
        WHEN commission_sequence = 0 THEN 'QUALIFICATION_MONTH'::bridge_ai."AffiliateReferralStatus"
        WHEN commission_sequence = programme."commissionPayments" THEN 'COMMISSION_COMPLETED'::bridge_ai."AffiliateReferralStatus"
        WHEN commission_sequence BETWEEN 1 AND programme."commissionPayments" THEN 'COMMISSION_ACTIVE'::bridge_ai."AffiliateReferralStatus"
        ELSE status END,
      "lastRecoveredAt" = CASE WHEN "lastPaymentFailedAt" IS NOT NULL THEN invoice_paid_at ELSE "lastRecoveredAt" END,
      "updatedAt" = now()
    WHERE id = referral.id;
  END IF;

  IF commission_sequence = 1 THEN
    INSERT INTO bridge_ai.affiliate_notifications (id, "affiliateId", type, title, body, "actionUrl", "createdAt")
    VALUES ('affiliate_notification_' || replace(gen_random_uuid()::text, '-', ''), referral."affiliateId",
      'COMMISSION_STARTED', 'Commission earning has started',
      'A referred supplier has completed qualification and generated the first eligible commission invoice.',
      '/affiliate/referrals', now());
  ELSIF commission_sequence = programme."commissionPayments" THEN
    INSERT INTO bridge_ai.affiliate_notifications (id, "affiliateId", type, title, body, "actionUrl", "createdAt")
    VALUES ('affiliate_notification_' || replace(gen_random_uuid()::text, '-', ''), referral."affiliateId",
      'COMMISSION_COMPLETED', 'Commission period completed',
      'A referred supplier has completed all commission-paying billing periods.',
      '/affiliate/referrals', now());
  END IF;

  INSERT INTO bridge_ai.affiliate_audit_logs (
    id, "affiliateId", action, "entityType", "entityId", summary, metadata, "createdAt"
  ) VALUES (
    'affiliate_audit_' || replace(gen_random_uuid()::text, '-', ''), referral."affiliateId",
    'AFFILIATE.INVOICE_LEDGER_RECORDED', 'AffiliateCommission', ledger_id,
    'Verified Stripe invoice recorded in the affiliate commission ledger',
    jsonb_build_object('stripeInvoiceId', stripe_invoice_id, 'paidBillingPeriod', paid_period,
      'commissionSequence', commission_sequence, 'commissionAmountPence', commission_amount,
      'eligibleRevenuePence', eligible_revenue_pence, 'status', ledger_status), now()
  );
  INSERT INTO bridge_ai."AuditLog" (id, "supplierCompanyId", action, "entityType", "entityId", summary, metadata, "createdAt")
  VALUES ('audit_' || replace(gen_random_uuid()::text, '-', ''), referral."supplierCompanyId",
    'AFFILIATE.INVOICE_LEDGER_RECORDED', 'AffiliateCommission', ledger_id,
    'Verified Stripe invoice recorded in immutable affiliate ledger',
    jsonb_build_object('stripeInvoiceId', stripe_invoice_id, 'ledgerStatus', ledger_status), now());
  RETURN ledger_id;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.record_affiliate_paid_invoice(text,text,text,text,text,text,integer,integer,integer,timestamptz,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.record_affiliate_paid_invoice(text,text,text,text,text,text,integer,integer,integer,timestamptz,timestamptz,timestamptz) TO bridge_ai_app;
