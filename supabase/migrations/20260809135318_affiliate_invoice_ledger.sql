-- Production affiliate accounting. Every successfully paid referred subscription
-- invoice receives one immutable ledger row. Refunds and disputes never rewrite
-- money fields; they reverse an unpaid row or add a separate negative adjustment.

CREATE TYPE bridge_ai."AffiliateStatus" AS ENUM ('PENDING','ACTIVE','SUSPENDED','REJECTED');
CREATE TYPE bridge_ai."AffiliateReferralStatus" AS ENUM (
  'CLICKED','REGISTERED','AWAITING_APPROVAL','APPROVED','QUALIFICATION_MONTH',
  'COMMISSION_ACTIVE','PAST_DUE','CANCELLATION_SCHEDULED','CANCELLED',
  'COMMISSION_COMPLETED','REJECTED'
);
CREATE TYPE bridge_ai."AffiliateCommissionEntryType" AS ENUM ('INVOICE','REFUND_ADJUSTMENT','DISPUTE_ADJUSTMENT');
CREATE TYPE bridge_ai."AffiliateCommissionStatus" AS ENUM (
  'QUALIFICATION','PENDING','AVAILABLE','SCHEDULED','PAID','REVERSED',
  'NOT_ELIGIBLE','ADJUSTMENT_PENDING','ADJUSTMENT_APPLIED'
);
CREATE TYPE bridge_ai."AffiliatePayoutStatus" AS ENUM ('PENDING','VALIDATING','AVAILABLE','SCHEDULED','PAID','REVERSED');
CREATE TYPE bridge_ai."AffiliateNotificationType" AS ENUM (
  'CANCELLATION_SCHEDULED','CANCELLATION_COMPLETED','PAYMENT_FAILED',
  'SUBSCRIPTION_RECOVERED','PLAN_UPGRADED','PLAN_DOWNGRADED',
  'COMMISSION_STARTED','COMMISSION_COMPLETED','COMMISSION_REVERSED',
  'PAYOUT_AVAILABLE','PAYOUT_PAID','SYSTEM'
);

CREATE TABLE bridge_ai.affiliate_programme (
  id text PRIMARY KEY DEFAULT 'default',
  "maximumActive" integer NOT NULL DEFAULT 10,
  "commissionRateBps" integer NOT NULL DEFAULT 1600,
  "qualificationPayments" integer NOT NULL DEFAULT 1,
  "commissionPayments" integer NOT NULL DEFAULT 12,
  "validationDays" integer NOT NULL DEFAULT 30,
  enabled boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_programme_singleton CHECK (id = 'default'),
  CONSTRAINT affiliate_programme_capacity_valid CHECK ("maximumActive" BETWEEN 1 AND 1000),
  CONSTRAINT affiliate_programme_rate_valid CHECK ("commissionRateBps" BETWEEN 0 AND 10000),
  CONSTRAINT affiliate_programme_periods_valid CHECK ("qualificationPayments" = 1 AND "commissionPayments" BETWEEN 1 AND 120),
  CONSTRAINT affiliate_programme_validation_valid CHECK ("validationDays" BETWEEN 0 AND 180)
);
INSERT INTO bridge_ai.affiliate_programme (id) VALUES ('default');

CREATE TABLE bridge_ai.affiliates (
  id text PRIMARY KEY,
  "userId" uuid NOT NULL UNIQUE REFERENCES bridge_ai.portal_profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  code varchar(24) NOT NULL UNIQUE,
  "displayName" text NOT NULL,
  status bridge_ai."AffiliateStatus" NOT NULL DEFAULT 'PENDING',
  "commissionRateBps" integer,
  "approvedAt" timestamptz,
  "approvedById" uuid,
  "suspendedAt" timestamptz,
  "suspensionReason" text,
  "fraudFlags" jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_code_format CHECK (code ~ '^[A-Z0-9]{4,24}$'),
  CONSTRAINT affiliate_rate_valid CHECK ("commissionRateBps" IS NULL OR "commissionRateBps" BETWEEN 0 AND 10000),
  CONSTRAINT affiliate_suspension_reason CHECK (status <> 'SUSPENDED' OR nullif(trim("suspensionReason"), '') IS NOT NULL)
);
CREATE INDEX affiliates_status_created_idx ON bridge_ai.affiliates(status, "createdAt");

CREATE TABLE bridge_ai.affiliate_referrals (
  id text PRIMARY KEY,
  "affiliateId" text NOT NULL REFERENCES bridge_ai.affiliates(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "supplierCompanyId" text NOT NULL UNIQUE REFERENCES bridge_ai.supplier_companies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "referralCode" varchar(24) NOT NULL,
  status bridge_ai."AffiliateReferralStatus" NOT NULL DEFAULT 'REGISTERED',
  "referredAt" timestamptz NOT NULL DEFAULT now(),
  "signupAt" timestamptz,
  "approvedAt" timestamptz,
  "firstPaidAt" timestamptz,
  "qualificationCompletedAt" timestamptz,
  "successfulPaidPeriods" integer NOT NULL DEFAULT 0,
  "eligibleCommissionPeriodsCompleted" integer NOT NULL DEFAULT 0,
  "cancellationScheduledAt" timestamptz,
  "cancelledAt" timestamptz,
  "completedAt" timestamptz,
  "lastPaymentFailedAt" timestamptz,
  "lastRecoveredAt" timestamptz,
  "attributionLockedAt" timestamptz,
  "attributionOverrideReason" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_period_counts_valid CHECK (
    "successfulPaidPeriods" >= 0
    AND "eligibleCommissionPeriodsCompleted" BETWEEN 0 AND 12
    AND "eligibleCommissionPeriodsCompleted" <= GREATEST("successfulPaidPeriods" - 1, 0)
  )
);
CREATE INDEX affiliate_referrals_affiliate_status_created_idx ON bridge_ai.affiliate_referrals("affiliateId", status, "createdAt");
CREATE INDEX affiliate_referrals_code_idx ON bridge_ai.affiliate_referrals("referralCode");

CREATE TABLE bridge_ai.referral_clicks (
  id text PRIMARY KEY,
  "affiliateId" text NOT NULL REFERENCES bridge_ai.affiliates(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "referralCode" varchar(24) NOT NULL,
  "attributionTokenHash" varchar(64),
  "ipHash" varchar(64),
  "userAgent" text,
  "landingPath" text,
  "convertedAt" timestamptz,
  "supplierCompanyId" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referral_clicks_affiliate_created_idx ON bridge_ai.referral_clicks("affiliateId", "createdAt");
CREATE INDEX referral_clicks_supplier_idx ON bridge_ai.referral_clicks("supplierCompanyId");

CREATE TABLE bridge_ai.affiliate_commissions (
  id text PRIMARY KEY,
  "externalLedgerKey" text NOT NULL UNIQUE,
  "entryType" bridge_ai."AffiliateCommissionEntryType" NOT NULL DEFAULT 'INVOICE',
  "affiliateId" text NOT NULL REFERENCES bridge_ai.affiliates(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "referralId" text NOT NULL REFERENCES bridge_ai.affiliate_referrals(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "supplierCompanyId" text NOT NULL REFERENCES bridge_ai.supplier_companies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "subscriptionId" text NOT NULL REFERENCES bridge_ai."Subscription"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "membershipPlanId" text REFERENCES bridge_ai."MembershipPlan"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "stripeInvoiceId" text NOT NULL,
  "stripePaymentId" text,
  "stripeChargeId" text,
  "stripeRefundId" text,
  "stripeDisputeId" text,
  "sourceCommissionId" text REFERENCES bridge_ai.affiliate_commissions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "planCode" text NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'GBP',
  "billingAmountPence" integer NOT NULL,
  "vatAmountPence" integer NOT NULL,
  "eligibleRevenuePence" integer NOT NULL,
  "commissionRateBps" integer NOT NULL,
  "commissionAmountPence" integer NOT NULL,
  "paidBillingPeriod" integer,
  "commissionSequence" integer,
  "billingPeriodStart" timestamptz,
  "billingPeriodEnd" timestamptz,
  status bridge_ai."AffiliateCommissionStatus" NOT NULL,
  "earnedAt" timestamptz NOT NULL,
  "validationAt" timestamptz,
  "validatedAt" timestamptz,
  "paidAt" timestamptz,
  "reversedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_commission_amounts_valid CHECK (
    "billingAmountPence" >= 0 AND "vatAmountPence" >= 0 AND "eligibleRevenuePence" >= 0
    AND "commissionRateBps" BETWEEN 0 AND 10000
  ),
  CONSTRAINT affiliate_invoice_sequence_valid CHECK (
    ("entryType" = 'INVOICE' AND "commissionAmountPence" >= 0 AND ("commissionSequence" IS NULL OR "commissionSequence" BETWEEN 0 AND 12))
    OR ("entryType" <> 'INVOICE' AND "commissionAmountPence" <= 0 AND "sourceCommissionId" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX affiliate_one_invoice_ledger_row
  ON bridge_ai.affiliate_commissions("stripeInvoiceId") WHERE "entryType" = 'INVOICE';
CREATE UNIQUE INDEX affiliate_one_refund_adjustment
  ON bridge_ai.affiliate_commissions("stripeRefundId") WHERE "stripeRefundId" IS NOT NULL;
CREATE UNIQUE INDEX affiliate_one_dispute_adjustment
  ON bridge_ai.affiliate_commissions("stripeDisputeId") WHERE "stripeDisputeId" IS NOT NULL;
CREATE INDEX affiliate_commissions_affiliate_earned_idx ON bridge_ai.affiliate_commissions("affiliateId", "earnedAt");
CREATE INDEX affiliate_commissions_affiliate_status_validation_idx ON bridge_ai.affiliate_commissions("affiliateId", status, "validationAt");
CREATE INDEX affiliate_commissions_referral_earned_idx ON bridge_ai.affiliate_commissions("referralId", "earnedAt");
CREATE INDEX affiliate_commissions_invoice_idx ON bridge_ai.affiliate_commissions("stripeInvoiceId");
CREATE INDEX affiliate_commissions_charge_idx ON bridge_ai.affiliate_commissions("stripeChargeId");
CREATE INDEX affiliate_commissions_supplier_idx ON bridge_ai.affiliate_commissions("supplierCompanyId");

CREATE TABLE bridge_ai.affiliate_payouts (
  id text PRIMARY KEY,
  "affiliateId" text NOT NULL REFERENCES bridge_ai.affiliates(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "statementReference" text NOT NULL UNIQUE,
  "periodStart" timestamptz NOT NULL,
  "periodEnd" timestamptz NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'GBP',
  "openingPendingBalancePence" integer NOT NULL,
  "commissionsEarnedPence" integer NOT NULL,
  "reversalsPence" integer NOT NULL,
  "adjustmentsPence" integer NOT NULL,
  "amountPaidPence" integer NOT NULL,
  "closingBalancePence" integer NOT NULL,
  status bridge_ai."AffiliatePayoutStatus" NOT NULL DEFAULT 'PENDING',
  "scheduledAt" timestamptz,
  "paidAt" timestamptz,
  "paymentReference" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_payout_period_valid CHECK ("periodEnd" >= "periodStart")
);
CREATE INDEX affiliate_payouts_affiliate_period_idx ON bridge_ai.affiliate_payouts("affiliateId", "periodStart", "periodEnd");
CREATE INDEX affiliate_payouts_status_created_idx ON bridge_ai.affiliate_payouts(status, "createdAt");

CREATE TABLE bridge_ai.affiliate_payout_items (
  id text PRIMARY KEY,
  "payoutId" text NOT NULL REFERENCES bridge_ai.affiliate_payouts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "commissionId" text NOT NULL UNIQUE REFERENCES bridge_ai.affiliate_commissions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "amountPence" integer NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX affiliate_payout_items_payout_idx ON bridge_ai.affiliate_payout_items("payoutId");

CREATE TABLE bridge_ai.affiliate_notifications (
  id text PRIMARY KEY,
  "affiliateId" text NOT NULL REFERENCES bridge_ai.affiliates(id) ON DELETE CASCADE ON UPDATE CASCADE,
  type bridge_ai."AffiliateNotificationType" NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  "actionUrl" text,
  "readAt" timestamptz,
  "emailedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX affiliate_notifications_affiliate_read_created_idx ON bridge_ai.affiliate_notifications("affiliateId", "readAt", "createdAt");

CREATE TABLE bridge_ai.affiliate_audit_logs (
  id text PRIMARY KEY,
  "affiliateId" text REFERENCES bridge_ai.affiliates(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "actorUserId" uuid REFERENCES bridge_ai.portal_profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  action text NOT NULL,
  "entityType" text NOT NULL,
  "entityId" text,
  summary text NOT NULL,
  metadata jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX affiliate_audit_affiliate_created_idx ON bridge_ai.affiliate_audit_logs("affiliateId", "createdAt");
CREATE INDEX affiliate_audit_entity_idx ON bridge_ai.affiliate_audit_logs("entityType", "entityId");
CREATE INDEX affiliate_audit_actor_created_idx ON bridge_ai.affiliate_audit_logs("actorUserId", "createdAt");

CREATE OR REPLACE FUNCTION bridge_private.enforce_affiliate_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE allowed integer; used integer;
BEGIN
  IF NEW.status <> 'ACTIVE' OR (TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('bridge-ai-affiliate-capacity'));
  SELECT "maximumActive" INTO allowed FROM bridge_ai.affiliate_programme WHERE id = 'default';
  SELECT count(*) INTO used FROM bridge_ai.affiliates WHERE status = 'ACTIVE' AND id <> NEW.id;
  IF used >= allowed THEN
    RAISE EXCEPTION 'maximum active affiliate capacity reached' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.enforce_affiliate_capacity() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER enforce_affiliate_capacity BEFORE INSERT OR UPDATE OF status ON bridge_ai.affiliates
FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_affiliate_capacity();

CREATE OR REPLACE FUNCTION bridge_private.protect_affiliate_commission_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'affiliate commission ledger rows cannot be deleted' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','validatedAt','paidAt','reversedAt'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','validatedAt','paidAt','reversedAt']) THEN
    RAISE EXCEPTION 'affiliate commission accounting fields are immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.protect_affiliate_commission_ledger() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER protect_affiliate_commission_ledger
BEFORE UPDATE OR DELETE ON bridge_ai.affiliate_commissions
FOR EACH ROW EXECUTE FUNCTION bridge_private.protect_affiliate_commission_ledger();

CREATE OR REPLACE FUNCTION bridge_private.attribute_supplier_referral(
  target_supplier_company_id text,
  target_user_id uuid,
  supplied_referral_code text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_affiliate bridge_ai.affiliates%ROWTYPE; referral_id text;
BEGIN
  IF session_user <> 'bridge_ai_app' THEN
    RAISE EXCEPTION 'trusted application role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO target_affiliate FROM bridge_ai.affiliates
  WHERE code = upper(trim(supplied_referral_code)) AND status = 'ACTIVE' FOR SHARE;
  IF target_affiliate.id IS NULL THEN
    RAISE EXCEPTION 'invalid affiliate referral code' USING ERRCODE = '22023';
  END IF;
  IF target_affiliate."userId" = target_user_id OR EXISTS (
    SELECT 1 FROM bridge_ai.company_memberships membership
    WHERE membership."supplierCompanyId" = target_supplier_company_id
      AND membership."userId" = target_affiliate."userId"
      AND membership.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'affiliate self-referral is not permitted' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM bridge_ai.affiliate_referrals WHERE "supplierCompanyId" = target_supplier_company_id) THEN
    RAISE EXCEPTION 'supplier attribution is already locked' USING ERRCODE = '23505';
  END IF;
  referral_id := 'affiliate_referral_' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO bridge_ai.affiliate_referrals (
    id, "affiliateId", "supplierCompanyId", "referralCode", status,
    "referredAt", "signupAt", "attributionLockedAt", "createdAt", "updatedAt"
  ) VALUES (
    referral_id, target_affiliate.id, target_supplier_company_id, target_affiliate.code,
    'AWAITING_APPROVAL', now(), now(), now(), now(), now()
  );
  UPDATE bridge_ai.referral_clicks SET "convertedAt" = now(), "supplierCompanyId" = target_supplier_company_id
  WHERE id = (
    SELECT id FROM bridge_ai.referral_clicks
    WHERE "affiliateId" = target_affiliate.id AND "convertedAt" IS NULL
    ORDER BY "createdAt" DESC LIMIT 1
  );
  INSERT INTO bridge_ai.affiliate_audit_logs (
    id, "affiliateId", "actorUserId", action, "entityType", "entityId", summary, metadata, "createdAt"
  ) VALUES (
    'affiliate_audit_' || replace(gen_random_uuid()::text, '-', ''), target_affiliate.id, target_user_id,
    'AFFILIATE.REFERRAL_ATTRIBUTED', 'AffiliateReferral', referral_id,
    'Supplier registration permanently attributed to affiliate',
    jsonb_build_object('supplierCompanyId', target_supplier_company_id, 'referralCode', target_affiliate.code), now()
  );
  RETURN referral_id;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.attribute_supplier_referral(text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- Registration and attribution are committed together. A bad, inactive or
-- manipulated code therefore cannot leave a partially created supplier.
CREATE OR REPLACE FUNCTION bridge_private.bootstrap_referred_supplier(
  auth_user_id uuid,
  supplier_email text,
  first_name text,
  last_name text,
  company_name text,
  contact_phone text,
  accepted_terms_version text,
  supplied_referral_code text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE company_id text;
BEGIN
  IF session_user <> 'bridge_ai_app' THEN
    RAISE EXCEPTION 'trusted application role required' USING ERRCODE = '42501';
  END IF;
  company_id := bridge_private.bootstrap_supplier(
    auth_user_id, supplier_email, first_name, last_name, company_name,
    contact_phone, accepted_terms_version
  );
  PERFORM bridge_private.attribute_supplier_referral(company_id, auth_user_id, supplied_referral_code);
  RETURN company_id;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.bootstrap_referred_supplier(uuid,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;

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
    IF paid_period = 1 THEN
      commission_sequence := 0;
      ledger_status := 'QUALIFICATION';
    ELSIF paid_period BETWEEN 2 AND programme."commissionPayments" + 1 THEN
      commission_sequence := paid_period - 1;
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
      "qualificationCompletedAt" = CASE WHEN paid_period >= 2 THEN coalesce("qualificationCompletedAt", invoice_paid_at) ELSE "qualificationCompletedAt" END,
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
      'COMMISSION_COMPLETED', '12-month commission period completed',
      'A referred supplier has completed all 12 commission-paying billing periods.',
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

-- Commission validation is an accounting state transition, not a browser
-- calculation. The scheduled accounting worker promotes immutable invoice and
-- adjustment rows after the programme validation period has elapsed.
CREATE OR REPLACE FUNCTION bridge_private.validate_affiliate_commissions()
RETURNS TABLE ("affiliateId" text, "validatedCount" integer, "availableAmountPence" bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF session_user <> 'bridge_ai_app'
     OR coalesce(current_setting('bridge_ai.worker_context', true), '') <> 'affiliate_accounting' THEN
    RAISE EXCEPTION 'trusted affiliate accounting worker required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH matured AS (
    UPDATE bridge_ai.affiliate_commissions commission
    SET status = 'AVAILABLE', "validatedAt" = now()
    WHERE commission.status IN ('PENDING', 'ADJUSTMENT_PENDING')
      AND commission."validationAt" IS NOT NULL
      AND commission."validationAt" <= now()
      AND NOT EXISTS (
        SELECT 1 FROM bridge_ai.affiliate_payout_items payout_item
        WHERE payout_item."commissionId" = commission.id
      )
    RETURNING commission."affiliateId", commission."commissionAmountPence"
  ), totals AS (
    SELECT matured."affiliateId", count(*)::integer AS "validatedCount",
      coalesce(sum(matured."commissionAmountPence"), 0)::bigint AS "availableAmountPence"
    FROM matured GROUP BY matured."affiliateId"
  ), notifications AS (
    INSERT INTO bridge_ai.affiliate_notifications (
      id, "affiliateId", type, title, body, "actionUrl", "createdAt"
    )
    SELECT 'affiliate_notification_' || replace(gen_random_uuid()::text, '-', ''),
      totals."affiliateId", 'PAYOUT_AVAILABLE', 'Commission available for payout',
      totals."validatedCount" || ' commission ledger entr' ||
        CASE WHEN totals."validatedCount" = 1 THEN 'y is' ELSE 'ies are' END ||
        ' now available after validation.', '/affiliate/earnings', now()
    FROM totals
    RETURNING "affiliateId"
  )
  SELECT totals."affiliateId", totals."validatedCount", totals."availableAmountPence"
  FROM totals;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.validate_affiliate_commissions() FROM PUBLIC, anon, authenticated, service_role;

-- RLS: affiliates can read only their own programme data. All accounting writes
-- remain administrator or narrowly scoped verified Stripe-worker operations.
ALTER TABLE bridge_ai.affiliate_programme ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliate_programme FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliates FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliate_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliate_referrals FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.referral_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.referral_clicks FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliate_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliate_commissions FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliate_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliate_payouts FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliate_payout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliate_payout_items FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliate_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliate_notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliate_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.affiliate_audit_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY affiliate_programme_authenticated_read ON bridge_ai.affiliate_programme
FOR SELECT TO authenticated USING (enabled OR (SELECT bridge_private.is_platform_admin()));
CREATE POLICY affiliate_programme_admin_manage ON bridge_ai.affiliate_programme
FOR ALL TO authenticated USING ((SELECT bridge_private.is_platform_admin())) WITH CHECK ((SELECT bridge_private.is_platform_admin()));
CREATE POLICY affiliate_programme_stripe_read ON bridge_ai.affiliate_programme
FOR SELECT TO authenticated USING ((SELECT bridge_private.is_trusted_worker('stripe_billing')));

CREATE POLICY affiliate_self_read ON bridge_ai.affiliates FOR SELECT TO authenticated
USING ("userId" = (SELECT bridge_private.current_user_id()) OR (SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('stripe_billing')) OR (SELECT bridge_private.is_trusted_worker('affiliate_attribution')));
CREATE POLICY affiliate_admin_manage ON bridge_ai.affiliates FOR ALL TO authenticated
USING ((SELECT bridge_private.is_platform_admin())) WITH CHECK ((SELECT bridge_private.is_platform_admin()));
CREATE POLICY affiliate_email_worker_read ON bridge_ai.affiliates FOR SELECT TO authenticated
USING ((SELECT bridge_private.is_trusted_worker('supplier_email')));

CREATE POLICY affiliate_profile_email_worker_read ON bridge_ai.portal_profiles FOR SELECT TO authenticated
USING ((SELECT bridge_private.is_trusted_worker('supplier_email')) AND EXISTS (
  SELECT 1 FROM bridge_ai.affiliates affiliate
  JOIN bridge_ai.affiliate_notifications notification ON notification."affiliateId" = affiliate.id
  WHERE affiliate."userId" = portal_profiles.id AND notification."emailedAt" IS NULL
));

CREATE POLICY affiliate_referral_owner_read ON bridge_ai.affiliate_referrals FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM bridge_ai.affiliates affiliate WHERE affiliate.id = "affiliateId" AND affiliate."userId" = (SELECT bridge_private.current_user_id())) OR (SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('stripe_billing')));
CREATE POLICY affiliate_referral_admin_manage ON bridge_ai.affiliate_referrals FOR ALL TO authenticated
USING ((SELECT bridge_private.is_platform_admin())) WITH CHECK ((SELECT bridge_private.is_platform_admin()));
CREATE POLICY affiliate_referral_stripe_update ON bridge_ai.affiliate_referrals FOR UPDATE TO authenticated
USING ((SELECT bridge_private.is_trusted_worker('stripe_billing'))) WITH CHECK ((SELECT bridge_private.is_trusted_worker('stripe_billing')));

CREATE POLICY referral_click_owner_read ON bridge_ai.referral_clicks FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM bridge_ai.affiliates affiliate WHERE affiliate.id = "affiliateId" AND affiliate."userId" = (SELECT bridge_private.current_user_id())) OR (SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('affiliate_attribution')));
CREATE POLICY referral_click_admin_manage ON bridge_ai.referral_clicks FOR ALL TO authenticated
USING ((SELECT bridge_private.is_platform_admin())) WITH CHECK ((SELECT bridge_private.is_platform_admin()));
CREATE POLICY referral_click_attribution_insert ON bridge_ai.referral_clicks FOR INSERT TO authenticated
WITH CHECK ((SELECT bridge_private.is_trusted_worker('affiliate_attribution')));
CREATE POLICY referral_click_attribution_update ON bridge_ai.referral_clicks FOR UPDATE TO authenticated
USING ((SELECT bridge_private.is_trusted_worker('affiliate_attribution'))) WITH CHECK ((SELECT bridge_private.is_trusted_worker('affiliate_attribution')));

CREATE POLICY affiliate_commission_owner_read ON bridge_ai.affiliate_commissions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM bridge_ai.affiliates affiliate WHERE affiliate.id = "affiliateId" AND affiliate."userId" = (SELECT bridge_private.current_user_id())) OR (SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('stripe_billing')));
CREATE POLICY affiliate_commission_admin_manage ON bridge_ai.affiliate_commissions FOR ALL TO authenticated
USING ((SELECT bridge_private.is_platform_admin())) WITH CHECK ((SELECT bridge_private.is_platform_admin()));
CREATE POLICY affiliate_commission_stripe_insert ON bridge_ai.affiliate_commissions FOR INSERT TO authenticated
WITH CHECK ((SELECT bridge_private.is_trusted_worker('stripe_billing')));
CREATE POLICY affiliate_commission_stripe_update ON bridge_ai.affiliate_commissions FOR UPDATE TO authenticated
USING ((SELECT bridge_private.is_trusted_worker('stripe_billing'))) WITH CHECK ((SELECT bridge_private.is_trusted_worker('stripe_billing')));

CREATE POLICY affiliate_payout_owner_read ON bridge_ai.affiliate_payouts FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM bridge_ai.affiliates affiliate WHERE affiliate.id = "affiliateId" AND affiliate."userId" = (SELECT bridge_private.current_user_id())) OR (SELECT bridge_private.is_platform_admin()));
CREATE POLICY affiliate_payout_admin_manage ON bridge_ai.affiliate_payouts FOR ALL TO authenticated
USING ((SELECT bridge_private.is_platform_admin())) WITH CHECK ((SELECT bridge_private.is_platform_admin()));
CREATE POLICY affiliate_payout_item_owner_read ON bridge_ai.affiliate_payout_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM bridge_ai.affiliate_payouts payout JOIN bridge_ai.affiliates affiliate ON affiliate.id = payout."affiliateId" WHERE payout.id = "payoutId" AND affiliate."userId" = (SELECT bridge_private.current_user_id())) OR (SELECT bridge_private.is_platform_admin()));
CREATE POLICY affiliate_payout_item_admin_manage ON bridge_ai.affiliate_payout_items FOR ALL TO authenticated
USING ((SELECT bridge_private.is_platform_admin())) WITH CHECK ((SELECT bridge_private.is_platform_admin()));

CREATE POLICY affiliate_notification_owner_read ON bridge_ai.affiliate_notifications FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM bridge_ai.affiliates affiliate WHERE affiliate.id = "affiliateId" AND affiliate."userId" = (SELECT bridge_private.current_user_id())) OR (SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('stripe_billing')));
CREATE POLICY affiliate_notification_owner_update ON bridge_ai.affiliate_notifications FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM bridge_ai.affiliates affiliate WHERE affiliate.id = "affiliateId" AND affiliate."userId" = (SELECT bridge_private.current_user_id())))
WITH CHECK (EXISTS (SELECT 1 FROM bridge_ai.affiliates affiliate WHERE affiliate.id = "affiliateId" AND affiliate."userId" = (SELECT bridge_private.current_user_id())));
CREATE POLICY affiliate_notification_admin_manage ON bridge_ai.affiliate_notifications FOR ALL TO authenticated
USING ((SELECT bridge_private.is_platform_admin())) WITH CHECK ((SELECT bridge_private.is_platform_admin()));
CREATE POLICY affiliate_notification_stripe_insert ON bridge_ai.affiliate_notifications FOR INSERT TO authenticated
WITH CHECK ((SELECT bridge_private.is_trusted_worker('stripe_billing')));
CREATE POLICY affiliate_notification_email_select ON bridge_ai.affiliate_notifications FOR SELECT TO authenticated
USING ((SELECT bridge_private.is_trusted_worker('supplier_email')) AND "emailedAt" IS NULL);
CREATE POLICY affiliate_notification_email_update ON bridge_ai.affiliate_notifications FOR UPDATE TO authenticated
USING ((SELECT bridge_private.is_trusted_worker('supplier_email')) AND "emailedAt" IS NULL)
WITH CHECK ((SELECT bridge_private.is_trusted_worker('supplier_email')));

CREATE POLICY affiliate_audit_owner_read ON bridge_ai.affiliate_audit_logs FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM bridge_ai.affiliates affiliate WHERE affiliate.id = "affiliateId" AND affiliate."userId" = (SELECT bridge_private.current_user_id())) OR (SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('stripe_billing')));
CREATE POLICY affiliate_audit_admin_manage ON bridge_ai.affiliate_audit_logs FOR ALL TO authenticated
USING ((SELECT bridge_private.is_platform_admin())) WITH CHECK ((SELECT bridge_private.is_platform_admin()));
CREATE POLICY affiliate_audit_stripe_insert ON bridge_ai.affiliate_audit_logs FOR INSERT TO authenticated
WITH CHECK ((SELECT bridge_private.is_trusted_worker('stripe_billing')));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridge_ai_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      bridge_ai.affiliate_programme, bridge_ai.affiliates, bridge_ai.affiliate_referrals,
      bridge_ai.referral_clicks, bridge_ai.affiliate_commissions, bridge_ai.affiliate_payouts,
      bridge_ai.affiliate_payout_items, bridge_ai.affiliate_notifications, bridge_ai.affiliate_audit_logs
    TO bridge_ai_app;
    GRANT EXECUTE ON FUNCTION bridge_private.attribute_supplier_referral(text, uuid, text) TO bridge_ai_app;
    GRANT EXECUTE ON FUNCTION bridge_private.bootstrap_referred_supplier(uuid,text,text,text,text,text,text,text) TO bridge_ai_app;
    GRANT EXECUTE ON FUNCTION bridge_private.record_affiliate_paid_invoice(text,text,text,text,text,text,integer,integer,integer,timestamptz,timestamptz,timestamptz) TO bridge_ai_app;
    GRANT EXECUTE ON FUNCTION bridge_private.validate_affiliate_commissions() TO bridge_ai_app;
  END IF;
END $$;

-- Supabase Realtime is used only for the affiliate's own rows, still constrained
-- by the table RLS policies above.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE
      bridge_ai.affiliate_referrals,
      bridge_ai.affiliate_commissions,
      bridge_ai.affiliate_notifications,
      bridge_ai.affiliate_payouts;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", summary, metadata, "createdAt")
VALUES (
  'system_affiliate_invoice_ledger_20260809131748',
  'SYSTEM.AFFILIATE_INVOICE_LEDGER_ENABLED',
  'SecurityConfiguration',
  'Enabled immutable invoice-backed affiliate accounting with strict tenant isolation',
  jsonb_build_object('defaultRateBps', 1600, 'qualificationPayments', 1, 'commissionPayments', 12, 'validationDays', 30, 'maximumActiveAffiliates', 10),
  now()
);
