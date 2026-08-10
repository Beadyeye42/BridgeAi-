-- Supplier onboarding must be completable before billing. Coverage configuration
-- uses the active plan when one exists, otherwise the safe Local Partner limit.
-- Automatic lead assignment deliberately continues to use
-- bridge_private.effective_membership_limits(), which requires an active plan.

CREATE OR REPLACE FUNCTION bridge_private.coverage_configuration_limits(target_company_id text)
RETURNS TABLE(tier bridge_ai."MembershipTier", maximum_radius integer, nationwide boolean, maximum_active integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    COALESCE(company."membershipTierOverride", active_plan.tier, onboarding_plan.tier),
    CASE
      WHEN company."membershipTierOverride" = 'NATIONWIDE' THEN NULL
      WHEN company."membershipTierOverride" = 'REGIONAL' THEN 100
      WHEN company."membershipTierOverride" = 'LOCAL' THEN 40
      WHEN active_plan.id IS NOT NULL THEN active_plan."maximumRadiusMiles"
      ELSE onboarding_plan."maximumRadiusMiles"
    END,
    CASE
      WHEN company."membershipTierOverride" IS NOT NULL
        THEN company."membershipTierOverride" = 'NATIONWIDE'
      WHEN active_plan.id IS NOT NULL THEN active_plan."nationwideAllowed"
      ELSE COALESCE(onboarding_plan."nationwideAllowed", false)
    END,
    COALESCE(
      company."maximumActiveOpportunitiesOverride",
      active_plan."maximumActiveOpportunities",
      onboarding_plan."maximumActiveOpportunities",
      0
    )
  FROM bridge_ai.supplier_companies company
  LEFT JOIN bridge_ai."Subscription" active_subscription
    ON active_subscription."supplierCompanyId" = company.id
   AND active_subscription.status = 'ACTIVE'
   AND (active_subscription."currentPeriodEnd" IS NULL OR active_subscription."currentPeriodEnd" > now())
  LEFT JOIN bridge_ai."MembershipPlan" active_plan
    ON active_plan.id = active_subscription."membershipPlanId"
   AND active_plan.active
  LEFT JOIN bridge_ai."MembershipPlan" onboarding_plan
    ON onboarding_plan.id = 'plan_local_partner'
   AND onboarding_plan.active
  WHERE company.id = target_company_id;
$$;

REVOKE ALL ON FUNCTION bridge_private.coverage_configuration_limits(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.coverage_configuration_limits(text) TO bridge_ai_app;
COMMENT ON FUNCTION bridge_private.coverage_configuration_limits(text) IS
  'Returns active membership limits or the safe Local Partner boundary solely for pre-billing coverage setup.';

CREATE OR REPLACE FUNCTION bridge_private.enforce_coverage_membership_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE limits record; permitted integer; origin_lat numeric; origin_lng numeric; centre_distance numeric;
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;
  SELECT * INTO limits FROM bridge_private.coverage_configuration_limits(NEW."supplierCompanyId");
  IF limits.tier IS NULL THEN
    RAISE EXCEPTION 'onboarding coverage configuration is unavailable' USING ERRCODE = '23514';
  END IF;
  IF NEW.type = 'NATIONWIDE' AND NOT limits.nationwide THEN
    RAISE EXCEPTION 'this membership does not permit nationwide coverage' USING ERRCODE = '23514';
  END IF;
  IF NEW.type = 'POSTCODE' THEN
    RAISE EXCEPTION 'postcode-area rules are not valid for geographic memberships; choose a radius from the company base' USING ERRCODE = '23514';
  END IF;
  permitted := CASE WHEN NEW.purpose = 'SERVICE'
    THEN COALESCE((SELECT "maximumServiceRadiusOverride" FROM bridge_ai.supplier_companies WHERE id=NEW."supplierCompanyId"), limits.maximum_radius)
    ELSE COALESCE((SELECT "maximumDeliveryRadiusOverride" FROM bridge_ai.supplier_companies WHERE id=NEW."supplierCompanyId"), limits.maximum_radius)
  END;
  IF NEW.type = 'DISTANCE' AND (permitted IS NULL OR NEW."radiusMiles" > permitted) AND NOT limits.nationwide THEN
    RAISE EXCEPTION 'coverage radius exceeds the active membership or onboarding limit' USING ERRCODE = '23514';
  END IF;
  IF NEW.type = 'DISTANCE' AND NOT limits.nationwide THEN
    SELECT "geographicOriginLatitude", "geographicOriginLongitude"
      INTO origin_lat, origin_lng
    FROM bridge_ai.supplier_companies WHERE id=NEW."supplierCompanyId";
    IF origin_lat IS NULL OR origin_lng IS NULL THEN
      RAISE EXCEPTION 'company geographic origin must be resolved before coverage is created' USING ERRCODE = '23514';
    END IF;
    centre_distance := 3958.7613 * 2 * asin(sqrt(
      power(sin(radians((NEW.latitude-origin_lat)/2)),2)
      + cos(radians(origin_lat))*cos(radians(NEW.latitude))*power(sin(radians((NEW.longitude-origin_lng)/2)),2)
    ));
    IF centre_distance + NEW."radiusMiles" > permitted + 0.01 THEN
      RAISE EXCEPTION 'coverage boundary exceeds the membership or onboarding radius from the company base' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_coverage_membership_limit() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.enforce_coverage_membership_limit() TO bridge_ai_app;

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'system_preplan_onboarding_coverage_20260810193007',
  'SYSTEM.PREPLAN_COVERAGE_ENABLED',
  'SecurityConfiguration',
  'supplier-onboarding-coverage',
  'Allowed safe Local Partner coverage setup before billing while preserving active-plan lead assignment controls',
  jsonb_build_object(
    'onboardingTier', 'LOCAL',
    'maximumRadiusMiles', 40,
    'billingRequiredForLeadAssignment', true
  ),
  now()
) ON CONFLICT (id) DO NOTHING;
