-- Free access and the paid ten-mile plan share the same industry eligibility.
ALTER TABLE bridge_ai."MembershipPlan" DROP CONSTRAINT "MembershipPlan_tier_key";
CREATE INDEX "MembershipPlan_tier_idx" ON bridge_ai."MembershipPlan" (tier);
ALTER TABLE bridge_ai."MembershipPlan" DROP CONSTRAINT membership_plan_price_positive;
ALTER TABLE bridge_ai."MembershipPlan" ADD CONSTRAINT membership_plan_price_positive CHECK (
  (id = 'plan_free_hyperlocal' AND code = 'bridge-ai-free-hyperlocal'
    AND tier = 'HYPERLOCAL' AND "monthlyPricePence" = 0
    AND "maximumRadiusMiles" IS NOT DISTINCT FROM 2 AND NOT "nationwideAllowed"
    AND NOT "taxEnabled" AND "providerProductId" IS NULL AND "providerPriceId" IS NULL)
  OR (id <> 'plan_free_hyperlocal' AND "monthlyPricePence" > 0)
);

INSERT INTO bridge_ai."MembershipPlan" (
  id, code, name, tier, description, "monthlyPricePence", "maximumRadiusMiles",
  "nationwideAllowed", "maximumActiveOpportunities", "taxEnabled", "displayOrder", "updatedAt"
) VALUES (
  'plan_free_hyperlocal', 'bridge-ai-free-hyperlocal', 'Free Hyperlocal', 'HYPERLOCAL',
  'Free matched opportunities up to 2 miles from your registered business base. No card required. Choose a paid plan for wider reach.',
  0, 2, false, 3, false, 0, now()
);

ALTER TABLE bridge_ai."Subscription" DROP CONSTRAINT subscription_complimentary_metadata_valid;
ALTER TABLE bridge_ai."Subscription" ADD CONSTRAINT subscription_complimentary_metadata_valid CHECK (
  ("accessSource" IN ('STRIPE','FREE')
    AND "complimentaryReason" IS NULL AND "complimentaryGrantedAt" IS NULL
    AND "complimentaryGrantedById" IS NULL AND "complimentaryRevokedAt" IS NULL
    AND "complimentaryRevokedById" IS NULL AND "complimentaryRevocationReason" IS NULL)
  OR ("accessSource" = 'COMPLIMENTARY'
    AND length(btrim("complimentaryReason")) BETWEEN 3 AND 500
    AND "complimentaryGrantedAt" IS NOT NULL AND "currentPeriodStart" IS NOT NULL
    AND "currentPeriodEnd" IS NOT NULL AND "currentPeriodEnd" > "currentPeriodStart")
);
ALTER TABLE bridge_ai."Subscription" ADD CONSTRAINT subscription_free_plan_valid CHECK (
  ("accessSource" = 'FREE' AND "membershipPlanId" IS NOT DISTINCT FROM 'plan_free_hyperlocal'
    AND "planCode" = 'bridge-ai-free-hyperlocal' AND provider = 'bridge-ai'
    AND "providerSubscriptionId" IS NULL AND "providerScheduleId" IS NULL
    AND "promotionId" IS NULL AND "currentPeriodEnd" IS NULL AND NOT "cancelAtPeriodEnd")
  OR ("accessSource" <> 'FREE' AND "membershipPlanId" IS DISTINCT FROM 'plan_free_hyperlocal')
);

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", "entityId", summary, metadata, "createdAt")
VALUES ('system_free_hyperlocal_20260906223546', 'SYSTEM.FREE_HYPERLOCAL_ENABLED', 'MembershipPlan',
  'plan_free_hyperlocal', 'Free two-mile membership added alongside existing paid plans',
  '{"radiusMiles":2,"monthlyPricePence":0,"existingSubscriptionsChanged":false}'::jsonb, now());
