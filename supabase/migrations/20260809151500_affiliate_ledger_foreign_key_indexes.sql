-- Cover every affiliate-ledger foreign key used by lifecycle, refund and plan
-- queries so accounting remains predictable as invoice volume grows.
CREATE INDEX affiliate_commissions_subscription_idx
  ON bridge_ai.affiliate_commissions("subscriptionId");
CREATE INDEX affiliate_commissions_membership_plan_idx
  ON bridge_ai.affiliate_commissions("membershipPlanId")
  WHERE "membershipPlanId" IS NOT NULL;
CREATE INDEX affiliate_commissions_source_idx
  ON bridge_ai.affiliate_commissions("sourceCommissionId")
  WHERE "sourceCommissionId" IS NOT NULL;

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", summary, metadata, "createdAt")
VALUES (
  'system_affiliate_ledger_indexes_20260809151500',
  'SYSTEM.AFFILIATE_LEDGER_INDEXES_ENABLED',
  'SecurityConfiguration',
  'Added covering indexes for affiliate ledger subscription, plan and adjustment relationships',
  jsonb_build_object('indexes', jsonb_build_array(
    'affiliate_commissions_subscription_idx',
    'affiliate_commissions_membership_plan_idx',
    'affiliate_commissions_source_idx'
  )),
  now()
);
