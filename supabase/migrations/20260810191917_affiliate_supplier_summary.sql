-- Affiliates may see the commercial progress of suppliers they personally
-- referred, but must not gain general SELECT access to supplier company rows.
-- This narrow, identity-derived projection avoids required-relation failures
-- under RLS without exposing addresses, contacts or wider company profile data.
CREATE OR REPLACE FUNCTION bridge_private.current_affiliate_referral_summaries()
RETURNS TABLE (
  "referralId" text,
  "supplierCompanyId" text,
  "supplierName" text,
  "referralStatus" text,
  "referredAt" timestamptz,
  "signupAt" timestamptz,
  "successfulPaidPeriods" integer,
  "eligibleCommissionPeriodsCompleted" integer,
  "cancellationScheduledAt" timestamptz,
  "cancelledAt" timestamptz,
  "subscriptionStatus" text,
  "subscriptionAccessSource" text,
  "planCode" text,
  "planName" text,
  "currentPeriodEnd" timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    referral.id,
    referral."supplierCompanyId",
    company."legalName",
    referral.status::text,
    referral."referredAt",
    referral."signupAt",
    referral."successfulPaidPeriods",
    referral."eligibleCommissionPeriodsCompleted",
    referral."cancellationScheduledAt",
    referral."cancelledAt",
    subscription.status::text,
    subscription."accessSource"::text,
    subscription."planCode",
    plan.name,
    subscription."currentPeriodEnd"
  FROM bridge_ai.affiliate_referrals AS referral
  JOIN bridge_ai.affiliates AS affiliate
    ON affiliate.id = referral."affiliateId"
  JOIN bridge_ai.supplier_companies AS company
    ON company.id = referral."supplierCompanyId"
  LEFT JOIN bridge_ai."Subscription" AS subscription
    ON subscription."supplierCompanyId" = company.id
  LEFT JOIN bridge_ai."MembershipPlan" AS plan
    ON plan.id = subscription."membershipPlanId"
  WHERE affiliate."userId" = bridge_private.current_user_id()
    AND affiliate.status = 'ACTIVE'::bridge_ai."AffiliateStatus"
  ORDER BY referral."referredAt" DESC, referral.id DESC;
$$;

REVOKE ALL ON FUNCTION bridge_private.current_affiliate_referral_summaries()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.current_affiliate_referral_summaries()
  TO authenticated;

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", summary, metadata, "createdAt")
VALUES (
  'system_affiliate_supplier_summary_20260810202500',
  'SYSTEM.AFFILIATE_SUPPLIER_SUMMARY_ENABLED',
  'SecurityConfiguration',
  'Enabled an identity-isolated affiliate supplier progress summary',
  jsonb_build_object(
    'exposedFields', jsonb_build_array(
      'supplierName', 'referralStatus', 'subscriptionStatus', 'planName',
      'billingPeriodEnd', 'commissionProgress'
    ),
    'excludedFields', jsonb_build_array(
      'contactEmail', 'contactPhone', 'address', 'companyProfile'
    )
  ),
  now()
)
ON CONFLICT (id) DO NOTHING;
