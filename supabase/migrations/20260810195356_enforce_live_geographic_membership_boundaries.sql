-- Geographic membership is a billing entitlement, not a display preference.
-- These controls make the current paid plan authoritative for every assignment
-- path, including administrator-created assignments and plan downgrades.

UPDATE bridge_ai."MembershipPlan"
SET "maximumRadiusMiles" = 40,
    "nationwideAllowed" = false,
    "updatedAt" = now()
WHERE tier = 'LOCAL';

UPDATE bridge_ai."MembershipPlan"
SET "maximumRadiusMiles" = 100,
    "nationwideAllowed" = false,
    "updatedAt" = now()
WHERE tier = 'REGIONAL';

UPDATE bridge_ai."MembershipPlan"
SET "maximumRadiusMiles" = NULL,
    "nationwideAllowed" = true,
    "updatedAt" = now()
WHERE tier = 'NATIONWIDE';

ALTER TABLE bridge_ai."MembershipPlan"
  DROP CONSTRAINT IF EXISTS membership_plan_radius_valid;
ALTER TABLE bridge_ai."MembershipPlan"
  ADD CONSTRAINT membership_plan_radius_valid CHECK (
    (tier = 'LOCAL' AND "maximumRadiusMiles" = 40 AND NOT "nationwideAllowed")
    OR (tier = 'REGIONAL' AND "maximumRadiusMiles" = 100 AND NOT "nationwideAllowed")
    OR (tier = 'NATIONWIDE' AND "maximumRadiusMiles" IS NULL AND "nationwideAllowed")
  );

CREATE OR REPLACE FUNCTION bridge_private.distance_miles(
  latitude_one numeric,
  longitude_one numeric,
  latitude_two numeric,
  longitude_two numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT 3958.7613 * 2 * asin(sqrt(
    least(1.0, greatest(0.0,
      power(sin(radians((latitude_two - latitude_one) / 2)), 2)
      + cos(radians(latitude_one)) * cos(radians(latitude_two))
        * power(sin(radians((longitude_two - longitude_one) / 2)), 2)
    ))
  ));
$$;

REVOKE ALL ON FUNCTION bridge_private.distance_miles(numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

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
  SELECT
    CASE
      WHEN plan.tier = 'NATIONWIDE' AND company."membershipTierOverride" IN ('LOCAL', 'REGIONAL')
        THEN company."membershipTierOverride"
      WHEN plan.tier = 'REGIONAL' AND company."membershipTierOverride" = 'LOCAL'
        THEN 'LOCAL'::bridge_ai."MembershipTier"
      ELSE plan.tier
    END AS effective_tier,
    CASE
      WHEN plan.tier = 'LOCAL' THEN 40
      WHEN plan.tier = 'REGIONAL' AND company."membershipTierOverride" = 'LOCAL' THEN 40
      WHEN plan.tier = 'REGIONAL' THEN 100
      WHEN plan.tier = 'NATIONWIDE' AND company."membershipTierOverride" = 'LOCAL' THEN 40
      WHEN plan.tier = 'NATIONWIDE' AND company."membershipTierOverride" = 'REGIONAL' THEN 100
      ELSE NULL
    END AS maximum_radius,
    plan.tier = 'NATIONWIDE'
      AND company."membershipTierOverride" IS DISTINCT FROM 'LOCAL'
      AND company."membershipTierOverride" IS DISTINCT FROM 'REGIONAL'
      AND plan."nationwideAllowed" AS nationwide,
    least(
      coalesce(company."maximumActiveOpportunitiesOverride", plan."maximumActiveOpportunities"),
      plan."maximumActiveOpportunities"
    ) AS maximum_active
  FROM bridge_ai.supplier_companies company
  JOIN bridge_ai."Subscription" subscription
    ON subscription."supplierCompanyId" = company.id
   AND subscription.status = 'ACTIVE'
   AND (subscription."currentPeriodEnd" IS NULL OR subscription."currentPeriodEnd" > now())
  JOIN bridge_ai."MembershipPlan" plan
    ON plan.id = subscription."membershipPlanId"
   AND plan.active
  WHERE company.id = target_company_id;
$$;

REVOKE ALL ON FUNCTION bridge_private.effective_membership_limits(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.effective_membership_limits(text) TO bridge_ai_app;

CREATE OR REPLACE FUNCTION bridge_private.coverage_configuration_limits(target_company_id text)
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
  SELECT
    CASE WHEN active_limits.tier IS NOT NULL THEN active_limits.tier ELSE onboarding_plan.tier END,
    CASE WHEN active_limits.tier IS NOT NULL THEN active_limits.maximum_radius ELSE onboarding_plan."maximumRadiusMiles" END,
    CASE WHEN active_limits.tier IS NOT NULL THEN active_limits.nationwide ELSE onboarding_plan."nationwideAllowed" END,
    CASE WHEN active_limits.tier IS NOT NULL THEN active_limits.maximum_active ELSE onboarding_plan."maximumActiveOpportunities" END
  FROM bridge_ai.supplier_companies company
  LEFT JOIN LATERAL bridge_private.effective_membership_limits(company.id) active_limits ON true
  LEFT JOIN bridge_ai."MembershipPlan" onboarding_plan
    ON onboarding_plan.id = 'plan_local_partner'
   AND onboarding_plan.active
  WHERE company.id = target_company_id;
$$;

REVOKE ALL ON FUNCTION bridge_private.coverage_configuration_limits(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.coverage_configuration_limits(text) TO bridge_ai_app;

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

DROP TRIGGER IF EXISTS enforce_coverage_membership_limit ON bridge_ai."CoverageArea";
CREATE TRIGGER enforce_coverage_membership_limit
  BEFORE INSERT OR UPDATE OF active, type, purpose, "radiusMiles", latitude, longitude, "supplierCompanyId"
  ON bridge_ai."CoverageArea"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_coverage_membership_limit();

CREATE OR REPLACE FUNCTION bridge_private.enforce_automatic_assignment_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  limits record;
  request_limit integer;
  request_active integer;
  supplier_active integer;
  request_lat numeric;
  request_lng numeric;
  request_mode bridge_ai."FulfilmentMode";
  origin_lat numeric;
  origin_lng numeric;
  configured_override integer;
  permitted integer;
  assignment_distance numeric;
BEGIN
  IF NEW.status NOT IN ('PENDING', 'VIEWED', 'ACCEPTED') THEN RETURN NEW; END IF;

  SELECT
    least(request."distributionLimit", config."maximumSuppliersPerRequest"),
    request."deliveryLatitude",
    request."deliveryLongitude",
    request."fulfilmentMode"
  INTO request_limit, request_lat, request_lng, request_mode
  FROM bridge_ai."QuoteRequest" request
  CROSS JOIN bridge_ai."MatchingConfiguration" config
  WHERE request.id = NEW."quoteRequestId" AND config.id = 'default';

  IF request_limit IS NULL THEN
    RAISE EXCEPTION 'quote request or matching configuration is unavailable' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO request_active
  FROM bridge_ai."SupplierAssignment"
  WHERE "quoteRequestId" = NEW."quoteRequestId"
    AND status IN ('PENDING', 'VIEWED', 'ACCEPTED')
    AND id <> NEW.id;
  IF request_active >= request_limit THEN
    RAISE EXCEPTION 'assignment would exceed the active supplier limit' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO limits
  FROM bridge_private.effective_membership_limits(NEW."supplierCompanyId");
  IF limits.tier IS NULL THEN
    RAISE EXCEPTION 'an active geographic membership is required to receive an opportunity' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO supplier_active
  FROM bridge_ai."SupplierAssignment" assignment
  JOIN bridge_ai."QuoteRequest" request ON request.id = assignment."quoteRequestId"
  WHERE assignment."supplierCompanyId" = NEW."supplierCompanyId"
    AND assignment.status IN ('PENDING', 'VIEWED', 'ACCEPTED')
    AND request.status IN ('OPEN', 'MATCHING', 'QUOTED')
    AND assignment.id <> NEW.id;
  IF limits.maximum_active < 1 OR supplier_active >= limits.maximum_active THEN
    RAISE EXCEPTION 'supplier active opportunity limit reached' USING ERRCODE = '23514';
  END IF;

  SELECT
    company."geographicOriginLatitude",
    company."geographicOriginLongitude",
    CASE WHEN request_mode IN ('SERVICE', 'INSTALLATION')
      THEN company."maximumServiceRadiusOverride"
      ELSE company."maximumDeliveryRadiusOverride"
    END
  INTO origin_lat, origin_lng, configured_override
  FROM bridge_ai.supplier_companies company
  WHERE company.id = NEW."supplierCompanyId";

  permitted := CASE
    WHEN limits.maximum_radius IS NULL THEN configured_override
    WHEN configured_override IS NULL THEN limits.maximum_radius
    ELSE least(configured_override, limits.maximum_radius)
  END;

  IF NOT limits.nationwide OR permitted IS NOT NULL THEN
    IF permitted IS NULL OR origin_lat IS NULL OR origin_lng IS NULL
      OR request_lat IS NULL OR request_lng IS NULL THEN
      RAISE EXCEPTION 'resolved supplier and request locations are required for this membership' USING ERRCODE = '23514';
    END IF;
    assignment_distance := bridge_private.distance_miles(origin_lat, origin_lng, request_lat, request_lng);
    IF assignment_distance > permitted + 0.01 THEN
      RAISE EXCEPTION 'opportunity is outside the supplier current membership radius' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_automatic_assignment_limits()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.enforce_automatic_assignment_limits() TO bridge_ai_app;

DROP TRIGGER IF EXISTS enforce_automatic_assignment_limits ON bridge_ai."SupplierAssignment";
CREATE TRIGGER enforce_automatic_assignment_limits
  BEFORE INSERT OR UPDATE OF status, "quoteRequestId", "supplierCompanyId", "assignedById"
  ON bridge_ai."SupplierAssignment"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_automatic_assignment_limits();

CREATE OR REPLACE FUNCTION bridge_private.reconcile_supplier_geographic_membership(target_company_id text)
RETURNS TABLE(deactivated_coverage integer, withdrawn_assignments integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  limits record;
  origin_lat numeric;
  origin_lng numeric;
  withdrawn_request_ids text[];
BEGIN
  deactivated_coverage := 0;
  withdrawn_assignments := 0;

  SELECT * INTO limits FROM bridge_private.effective_membership_limits(target_company_id);
  IF limits.tier IS NULL THEN RETURN NEXT; RETURN; END IF;

  SELECT "geographicOriginLatitude", "geographicOriginLongitude"
    INTO origin_lat, origin_lng
  FROM bridge_ai.supplier_companies
  WHERE id = target_company_id;

  WITH invalid_coverage AS (
    SELECT area.id
    FROM bridge_ai."CoverageArea" area
    JOIN bridge_ai.supplier_companies company ON company.id = area."supplierCompanyId"
    CROSS JOIN LATERAL (
      SELECT CASE WHEN area.purpose = 'SERVICE'
        THEN company."maximumServiceRadiusOverride"
        ELSE company."maximumDeliveryRadiusOverride"
      END AS configured_override
    ) configured
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN limits.maximum_radius IS NULL THEN configured.configured_override
        WHEN configured.configured_override IS NULL THEN limits.maximum_radius
        ELSE least(configured.configured_override, limits.maximum_radius)
      END AS permitted
    ) boundary
    WHERE area."supplierCompanyId" = target_company_id
      AND area.active
      AND (
        (area.type = 'NATIONWIDE' AND NOT limits.nationwide)
        OR (area.type = 'DISTANCE' AND (NOT limits.nationwide OR boundary.permitted IS NOT NULL) AND (
          boundary.permitted IS NULL
          OR origin_lat IS NULL OR origin_lng IS NULL
          OR area.latitude IS NULL OR area.longitude IS NULL
          OR area."radiusMiles" > boundary.permitted
          OR bridge_private.distance_miles(origin_lat, origin_lng, area.latitude, area.longitude)
             + area."radiusMiles" > boundary.permitted + 0.01
        ))
      )
  )
  UPDATE bridge_ai."CoverageArea" area
  SET active = false, "updatedAt" = now()
  FROM invalid_coverage invalid
  WHERE area.id = invalid.id;
  GET DIAGNOSTICS deactivated_coverage = ROW_COUNT;

  WITH invalid_assignments AS (
    SELECT assignment.id, assignment."quoteRequestId"
    FROM bridge_ai."SupplierAssignment" assignment
    JOIN bridge_ai."QuoteRequest" request ON request.id = assignment."quoteRequestId"
    JOIN bridge_ai.supplier_companies company ON company.id = assignment."supplierCompanyId"
    CROSS JOIN LATERAL (
      SELECT CASE WHEN request."fulfilmentMode" IN ('SERVICE', 'INSTALLATION')
        THEN company."maximumServiceRadiusOverride"
        ELSE company."maximumDeliveryRadiusOverride"
      END AS configured_override
    ) configured
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN limits.maximum_radius IS NULL THEN configured.configured_override
        WHEN configured.configured_override IS NULL THEN limits.maximum_radius
        ELSE least(configured.configured_override, limits.maximum_radius)
      END AS permitted
    ) boundary
    WHERE assignment."supplierCompanyId" = target_company_id
      AND assignment.status IN ('PENDING', 'VIEWED', 'ACCEPTED')
      AND request.status IN ('OPEN', 'MATCHING', 'QUOTED')
      AND (NOT limits.nationwide OR boundary.permitted IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM bridge_ai."SupplierQuotation" quotation
        WHERE quotation."assignmentId" = assignment.id
          AND quotation.status IN ('SUBMITTED', 'SELECTED_PENDING_PAYMENT', 'ACCEPTED')
      )
      AND (
        boundary.permitted IS NULL
        OR origin_lat IS NULL OR origin_lng IS NULL
        OR request."deliveryLatitude" IS NULL OR request."deliveryLongitude" IS NULL
        OR bridge_private.distance_miles(
          origin_lat, origin_lng, request."deliveryLatitude", request."deliveryLongitude"
        ) > boundary.permitted + 0.01
      )
  ), withdrawn AS (
    UPDATE bridge_ai."SupplierAssignment" assignment
    SET status = 'WITHDRAWN',
        "respondedAt" = now(),
        "declinedReason" = 'Membership geography changed; opportunity is outside the current plan.'
    FROM invalid_assignments invalid
    WHERE assignment.id = invalid.id
    RETURNING assignment."quoteRequestId"
  )
  SELECT count(*)::integer, coalesce(array_agg("quoteRequestId"), ARRAY[]::text[])
    INTO withdrawn_assignments, withdrawn_request_ids
  FROM withdrawn;

  UPDATE bridge_ai."SupplierMatchDecision" decision
  SET selected = false,
      outcome = 'REJECTED',
      reasons = coalesce(decision.reasons, '[]'::jsonb)
        || jsonb_build_array('Membership geography changed; outside current plan')
  WHERE decision."supplierCompanyId" = target_company_id
    AND decision."quoteRequestId" = ANY(withdrawn_request_ids);

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.reconcile_supplier_geographic_membership(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.reconcile_supplier_geographic_membership(text) TO bridge_ai_app;

CREATE OR REPLACE FUNCTION bridge_private.reconcile_geographic_membership_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_company_id text;
  result record;
BEGIN
  IF TG_TABLE_NAME = 'Subscription' THEN
    target_company_id := NEW."supplierCompanyId";
  ELSE
    target_company_id := NEW.id;
  END IF;

  SELECT * INTO result
  FROM bridge_private.reconcile_supplier_geographic_membership(target_company_id);

  IF coalesce(result.deactivated_coverage, 0) > 0 OR coalesce(result.withdrawn_assignments, 0) > 0 THEN
    INSERT INTO bridge_ai."AuditLog" (
      id, action, "entityType", "entityId", summary, metadata, "createdAt"
    ) VALUES (
      'geo_reconcile_' || replace(gen_random_uuid()::text, '-', ''),
      'MEMBERSHIP.GEOGRAPHY_RECONCILED',
      'SupplierCompany',
      target_company_id,
      'Reconciled supplier coverage and open opportunities to the current membership geography',
      jsonb_build_object(
        'deactivatedCoverage', result.deactivated_coverage,
        'withdrawnAssignments', result.withdrawn_assignments
      ),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.reconcile_geographic_membership_trigger()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS reconcile_geographic_membership_after_subscription ON bridge_ai."Subscription";
CREATE TRIGGER reconcile_geographic_membership_after_subscription
  AFTER INSERT OR UPDATE OF status, "membershipPlanId", "currentPeriodEnd"
  ON bridge_ai."Subscription"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.reconcile_geographic_membership_trigger();

DROP TRIGGER IF EXISTS reconcile_geographic_membership_after_supplier_change ON bridge_ai.supplier_companies;
CREATE TRIGGER reconcile_geographic_membership_after_supplier_change
  AFTER UPDATE OF "membershipTierOverride", "maximumActiveOpportunitiesOverride",
    "maximumServiceRadiusOverride", "maximumDeliveryRadiusOverride",
    "geographicOriginLatitude", "geographicOriginLongitude"
  ON bridge_ai.supplier_companies
  FOR EACH ROW EXECUTE FUNCTION bridge_private.reconcile_geographic_membership_trigger();

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'system_live_geographic_plan_boundaries_20260810195356',
  'SYSTEM.GEOGRAPHIC_PLAN_BOUNDARIES_ENFORCED',
  'SecurityConfiguration',
  'geographic-membership',
  'Made the current paid membership plan authoritative for coverage and every supplier assignment path',
  jsonb_build_object(
    'localRadiusMiles', 40,
    'regionalRadiusMiles', 100,
    'nationwideRadiusMiles', NULL,
    'manualAssignmentsEnforced', true,
    'downgradeReconciliationEnabled', true
  ),
  now()
) ON CONFLICT (id) DO NOTHING;
