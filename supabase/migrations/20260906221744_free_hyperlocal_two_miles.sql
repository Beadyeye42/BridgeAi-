-- Forward-only migration: historical migrations retain their original seed values.
-- Existing Stripe subscriptions must be moved to a zero Price before release.
-- This migration never cancels, refunds, or otherwise mutates Stripe billing.
ALTER TABLE bridge_ai."MembershipPlan" DROP CONSTRAINT membership_plan_price_positive;
ALTER TABLE bridge_ai."MembershipPlan" ADD CONSTRAINT membership_plan_price_valid
  CHECK ((tier = 'HYPERLOCAL' AND "monthlyPricePence" = 0)
      OR (tier <> 'HYPERLOCAL' AND "monthlyPricePence" > 0)) NOT VALID;
ALTER TABLE bridge_ai."MembershipPlan" DROP CONSTRAINT membership_plan_radius_valid;
ALTER TABLE bridge_ai."MembershipPlan" ADD CONSTRAINT membership_plan_radius_valid CHECK (
  (tier = 'HYPERLOCAL' AND "maximumRadiusMiles" IS NOT NULL AND "maximumRadiusMiles" = 2 AND NOT "nationwideAllowed")
  OR (tier = 'LOCAL' AND "maximumRadiusMiles" = 40 AND NOT "nationwideAllowed")
  OR (tier = 'REGIONAL' AND "maximumRadiusMiles" = 100 AND NOT "nationwideAllowed")
  OR (tier = 'NATIONWIDE' AND "maximumRadiusMiles" IS NULL AND "nationwideAllowed")
) NOT VALID;

CREATE OR REPLACE FUNCTION bridge_private.effective_membership_limits(target_company_id text)
RETURNS TABLE(
  tier bridge_ai."MembershipTier",
  maximum_radius integer,
  nationwide boolean,
  maximum_active integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH purchased AS (
    SELECT company.*, plan.*,
      CASE
        WHEN plan.tier = 'HYPERLOCAL' THEN 'HYPERLOCAL'::bridge_ai."MembershipTier"
        WHEN plan.tier = 'LOCAL' AND company."membershipTierOverride" = 'HYPERLOCAL' THEN 'HYPERLOCAL'::bridge_ai."MembershipTier"
        WHEN plan.tier = 'REGIONAL' AND company."membershipTierOverride" IN ('HYPERLOCAL', 'LOCAL') THEN company."membershipTierOverride"
        WHEN plan.tier = 'NATIONWIDE' AND company."membershipTierOverride" IN ('HYPERLOCAL', 'LOCAL', 'REGIONAL') THEN company."membershipTierOverride"
        ELSE plan.tier
      END AS effective_tier
    FROM bridge_ai.supplier_companies company
    JOIN bridge_ai."Subscription" subscription
      ON subscription."supplierCompanyId" = company.id
     AND subscription.status = 'ACTIVE'
     AND (subscription."currentPeriodEnd" IS NULL OR subscription."currentPeriodEnd" > now())
    JOIN bridge_ai."MembershipPlan" plan
      ON plan.id = subscription."membershipPlanId"
     AND plan.active
    WHERE company.id = target_company_id
  )
  SELECT
    purchased.effective_tier,
    CASE purchased.effective_tier
      WHEN 'HYPERLOCAL' THEN 2
      WHEN 'LOCAL' THEN 40
      WHEN 'REGIONAL' THEN 100
      ELSE NULL
    END,
    purchased.effective_tier = 'NATIONWIDE' AND purchased."nationwideAllowed",
    least(
      coalesce(purchased."maximumActiveOpportunitiesOverride", purchased."maximumActiveOpportunities"),
      purchased."maximumActiveOpportunities"
    )
  FROM purchased;
$$;

REVOKE ALL ON FUNCTION bridge_private.effective_membership_limits(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.effective_membership_limits(text) TO bridge_ai_app;


-- Keep usable coverage at the registered base. Off-base, nationwide or restricted
-- rules are deactivated rather than silently moving the supplier's operating base.
UPDATE bridge_ai."CoverageArea" area
SET active = false, "updatedAt" = now()
FROM bridge_ai.supplier_companies company, bridge_ai."Subscription" subscription,
     bridge_ai."MembershipPlan" plan
WHERE area."supplierCompanyId" = company.id
  AND subscription."supplierCompanyId" = company.id AND subscription."membershipPlanId" = plan.id
  AND (plan.tier = 'HYPERLOCAL' OR company."membershipTierOverride" = 'HYPERLOCAL')
  AND area.active AND (area.type <> 'DISTANCE'
    OR company."geographicOriginLatitude" IS NULL OR company."geographicOriginLongitude" IS NULL
    OR area.latitude IS NULL OR area.longitude IS NULL
    OR bridge_private.distance_miles(company."geographicOriginLatitude", company."geographicOriginLongitude", area.latitude, area.longitude) > 0.01
    OR (CASE WHEN area.purpose = 'SERVICE' THEN company."maximumServiceRadiusOverride" ELSE company."maximumDeliveryRadiusOverride" END) < 2);

UPDATE bridge_ai."CoverageArea" area
SET "radiusMiles" = 2, "updatedAt" = now()
FROM bridge_ai.supplier_companies company, bridge_ai."Subscription" subscription,
     bridge_ai."MembershipPlan" plan
WHERE area."supplierCompanyId" = company.id
  AND subscription."supplierCompanyId" = company.id AND subscription."membershipPlanId" = plan.id
  AND (plan.tier = 'HYPERLOCAL' OR company."membershipTierOverride" = 'HYPERLOCAL')
  AND area.active AND area.type = 'DISTANCE';

UPDATE bridge_ai."MembershipPlan"
SET "monthlyPricePence" = 0, "maximumRadiusMiles" = 2,
    description = 'Free membership with a fixed 2-mile radius in eligible industries.',
    "providerPriceId" = NULL, "taxEnabled" = false, "updatedAt" = now()
WHERE tier = 'HYPERLOCAL';
ALTER TABLE bridge_ai."MembershipPlan" VALIDATE CONSTRAINT membership_plan_price_valid;
ALTER TABLE bridge_ai."MembershipPlan" VALIDATE CONSTRAINT membership_plan_radius_valid;

CREATE OR REPLACE FUNCTION bridge_private.enforce_coverage_membership_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  limits record;
  configured_override integer;
  permitted integer;
  origin_lat numeric;
  origin_lng numeric;
  centre_distance numeric;
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;

  SELECT * INTO limits
  FROM bridge_private.coverage_configuration_limits(NEW."supplierCompanyId");
  IF limits.tier IS NULL THEN
    RAISE EXCEPTION 'onboarding coverage configuration is unavailable' USING ERRCODE = '23514';
  END IF;
  IF limits.tier = 'HYPERLOCAL' AND (NEW.type <> 'DISTANCE' OR NEW."radiusMiles" IS DISTINCT FROM 2) THEN
    RAISE EXCEPTION 'hyperlocal coverage requires a fixed 2-mile radius' USING ERRCODE = '23514';
  END IF;
  IF NEW.type = 'POSTCODE' THEN
    RAISE EXCEPTION 'postcode-area rules are not valid for geographic memberships; choose a radius from the company base' USING ERRCODE = '23514';
  END IF;

  SELECT CASE WHEN NEW.purpose = 'SERVICE'
    THEN company."maximumServiceRadiusOverride"
    ELSE company."maximumDeliveryRadiusOverride"
  END
  INTO configured_override
  FROM bridge_ai.supplier_companies company
  WHERE company.id = NEW."supplierCompanyId";

  permitted := CASE
    WHEN limits.maximum_radius IS NULL THEN configured_override
    WHEN configured_override IS NULL THEN limits.maximum_radius
    ELSE least(configured_override, limits.maximum_radius)
  END;

  IF NEW.type = 'NATIONWIDE' AND (NOT limits.nationwide OR permitted IS NOT NULL) THEN
    RAISE EXCEPTION 'this membership does not permit unrestricted nationwide coverage for this purpose' USING ERRCODE = '23514';
  END IF;

  IF NEW.type = 'DISTANCE' AND permitted IS NOT NULL
    AND NEW."radiusMiles" > permitted THEN
    RAISE EXCEPTION 'coverage radius exceeds the active membership or onboarding limit' USING ERRCODE = '23514';
  END IF;

  IF NEW.type = 'DISTANCE' AND permitted IS NOT NULL THEN
    SELECT company."geographicOriginLatitude", company."geographicOriginLongitude"
      INTO origin_lat, origin_lng
    FROM bridge_ai.supplier_companies company
    WHERE company.id = NEW."supplierCompanyId";

    IF origin_lat IS NULL OR origin_lng IS NULL OR NEW.latitude IS NULL OR NEW.longitude IS NULL THEN
      RAISE EXCEPTION 'company geographic origin and coverage centre must be resolved before coverage is created' USING ERRCODE = '23514';
    END IF;

    centre_distance := bridge_private.distance_miles(
      origin_lat, origin_lng, NEW.latitude, NEW.longitude
    );
    IF centre_distance + NEW."radiusMiles" > permitted + 0.01 THEN
      RAISE EXCEPTION 'coverage boundary exceeds the membership or onboarding radius from the company base' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_coverage_membership_limit()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.enforce_coverage_membership_limit() TO bridge_ai_app;

-- Reconcile live assignments using the latest collection-aware implementation.
SELECT bridge_private.reconcile_supplier_geographic_membership(company.id)
FROM bridge_ai.supplier_companies company
JOIN bridge_ai."Subscription" subscription ON subscription."supplierCompanyId" = company.id
JOIN bridge_ai."MembershipPlan" plan ON plan.id = subscription."membershipPlanId"
WHERE plan.tier = 'HYPERLOCAL' OR company."membershipTierOverride" = 'HYPERLOCAL';

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", "entityId", summary, metadata, "createdAt")
VALUES ('system_free_hyperlocal_two_miles', 'SYSTEM.HYPERLOCAL_MADE_FREE', 'MembershipPlan',
  'plan_hyperlocal_partner', 'Hyperlocal made free with fixed 2-mile coverage; existing geography reconciled',
  jsonb_build_object('pricePence', 0, 'radiusMiles', 2, 'industryRestrictionsPreserved', true,
    'opportunityLimitsPreserved', true), now());
