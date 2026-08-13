ALTER TABLE bridge_ai."QuoteRequest"
  ADD COLUMN IF NOT EXISTS "matchingPostcode" text,
  ADD COLUMN IF NOT EXISTS "matchingLatitude" numeric(9, 6),
  ADD COLUMN IF NOT EXISTS "matchingLongitude" numeric(9, 6),
  ADD COLUMN IF NOT EXISTS "matchingCoveragePurpose" bridge_ai."CoveragePurpose";

CREATE INDEX IF NOT EXISTS "QuoteRequest_categoryId_matchingPostcode_idx"
  ON bridge_ai."QuoteRequest"("categoryId", "matchingPostcode");

UPDATE bridge_ai."QuoteRequest" request
SET
  "matchingPostcode" = CASE
    WHEN category.slug IN (
      'transport-delivery-removals', 'man-with-a-van', 'trade-collection-delivery',
      'same-day-courier', 'furniture-small-removals', 'bulky-item-transport',
      'building-material-deliveries', 'multi-drop-delivery'
    ) OR parent.slug = 'transport-delivery-removals'
      THEN (regexp_match(
        request.summary,
        '(?i)(?:collection(?:\s+postcode)?|collect(?:ed)?\s+from|pick[- ]?up(?:\s+from)?)\D{0,30}?(GIR\s?0AA|[A-PR-UWYZ][A-HK-Y]?[0-9][A-Z0-9]?\s?[0-9][ABD-HJLNP-UW-Z]{2})'
      ))[1]
    ELSE request."deliveryPostcode"
  END,
  "matchingLatitude" = CASE
    WHEN category.slug IN (
      'transport-delivery-removals', 'man-with-a-van', 'trade-collection-delivery',
      'same-day-courier', 'furniture-small-removals', 'bulky-item-transport',
      'building-material-deliveries', 'multi-drop-delivery'
    ) OR parent.slug = 'transport-delivery-removals' THEN NULL
    ELSE request."deliveryLatitude"
  END,
  "matchingLongitude" = CASE
    WHEN category.slug IN (
      'transport-delivery-removals', 'man-with-a-van', 'trade-collection-delivery',
      'same-day-courier', 'furniture-small-removals', 'bulky-item-transport',
      'building-material-deliveries', 'multi-drop-delivery'
    ) OR parent.slug = 'transport-delivery-removals' THEN NULL
    ELSE request."deliveryLongitude"
  END,
  "matchingCoveragePurpose" = CASE
    WHEN category.slug IN (
      'transport-delivery-removals', 'man-with-a-van', 'trade-collection-delivery',
      'same-day-courier', 'furniture-small-removals', 'bulky-item-transport',
      'building-material-deliveries', 'multi-drop-delivery'
    ) OR parent.slug = 'transport-delivery-removals' THEN 'DELIVERY'::bridge_ai."CoveragePurpose"
    WHEN request."fulfilmentMode" IN ('SERVICE', 'INSTALLATION') THEN 'SERVICE'::bridge_ai."CoveragePurpose"
    ELSE 'DELIVERY'::bridge_ai."CoveragePurpose"
  END
FROM bridge_ai."ProductCategory" category
LEFT JOIN bridge_ai."ProductCategory" parent ON parent.id = category."parentId"
WHERE category.id = request."categoryId"
  AND request."matchingPostcode" IS NULL;

CREATE OR REPLACE FUNCTION bridge_private.enforce_automatic_assignment_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $transport_assignment$
DECLARE
  limits record;
  settings record;
  density bridge_ai."MarketDensityMode";
  request_limit integer;
  request_active integer;
  supplier_active integer;
  request_lat numeric;
  request_lng numeric;
  request_purpose bridge_ai."CoveragePurpose";
  request_category text;
  capacity_status bridge_ai."SupplierCapacityStatus";
  origin_lat numeric;
  origin_lng numeric;
  configured_override integer;
  permitted integer;
  assignment_distance numeric;
  effective_active_limit integer;
  override_is_authorised boolean := false;
BEGIN
  IF NEW.status NOT IN ('PENDING', 'VIEWED', 'ACCEPTED') THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('request:' || NEW."quoteRequestId", 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('supplier:' || NEW."supplierCompanyId", 0));

  SELECT configuration.* INTO settings
  FROM bridge_ai."MatchingConfiguration" configuration
  WHERE configuration.id = 'default';

  SELECT
    least(request."distributionLimit", settings."maximumSuppliersPerRequest", 5),
    coalesce(request."matchingLatitude", request."deliveryLatitude"),
    coalesce(request."matchingLongitude", request."deliveryLongitude"),
    coalesce(
      request."matchingCoveragePurpose",
      CASE WHEN request."fulfilmentMode" IN ('SERVICE', 'INSTALLATION')
        THEN 'SERVICE'::bridge_ai."CoveragePurpose"
        ELSE 'DELIVERY'::bridge_ai."CoveragePurpose"
      END
    ),
    request."categoryId",
    request."marketDensityMode"
  INTO request_limit, request_lat, request_lng, request_purpose, request_category, density
  FROM bridge_ai."QuoteRequest" request
  WHERE request.id = NEW."quoteRequestId";

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

  SELECT * INTO limits FROM bridge_private.effective_membership_limits(NEW."supplierCompanyId");
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
  effective_active_limit := limits.maximum_active + CASE
    WHEN density = 'HEALTHY'::bridge_ai."MarketDensityMode" THEN settings."healthySoftCapExtraOpportunities"
    ELSE 0
  END;
  IF supplier_active >= limits.maximum_active
    AND density = 'SPARSE'::bridge_ai."MarketDensityMode"
    AND settings."sparseSoftCapEnabled" THEN
    NEW."softCapOverride" := true;
  ELSIF limits.maximum_active < 1 OR supplier_active >= effective_active_limit THEN
    RAISE EXCEPTION 'supplier active opportunity limit reached for the current market density' USING ERRCODE = '23514';
  END IF;

  IF NEW."capacityOverride" THEN
    SELECT EXISTS (
      SELECT 1 FROM bridge_ai.platform_administrators administrator
      WHERE administrator."userId" = NEW."assignedById" AND administrator.active
    ) INTO override_is_authorised;
    IF NOT override_is_authorised THEN
      RAISE EXCEPTION 'capacity override requires an active platform administrator' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT capability."capacityStatus" INTO capacity_status
  FROM bridge_ai."SupplierCapability" capability
  JOIN bridge_ai."ProductCategory" capability_category ON capability_category.id = capability."productCategoryId"
  JOIN bridge_ai."ProductCategory" request_category_row ON request_category_row.id = request_category
  WHERE capability."supplierCompanyId" = NEW."supplierCompanyId" AND capability.active
    AND (capability."productCategoryId" = request_category
      OR capability_category."parentId" = request_category
      OR request_category_row."parentId" = capability."productCategoryId")
  ORDER BY (capability."productCategoryId" = request_category) DESC, capability."lastConfirmedAt" DESC
  LIMIT 1;
  IF capacity_status IN ('FULL', 'PAUSED', 'HOLIDAY', 'NOT_ACCEPTING') AND NOT NEW."capacityOverride" THEN
    RAISE EXCEPTION 'supplier operational capacity does not allow a new opportunity' USING ERRCODE = '23514';
  END IF;

  SELECT
    company."geographicOriginLatitude",
    company."geographicOriginLongitude",
    CASE WHEN request_purpose = 'SERVICE'
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
$transport_assignment$;

REVOKE ALL ON FUNCTION bridge_private.enforce_automatic_assignment_limits()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.enforce_automatic_assignment_limits() TO bridge_ai_app;

CREATE OR REPLACE FUNCTION bridge_private.reconcile_supplier_geographic_membership(target_company_id text)
RETURNS TABLE(deactivated_coverage integer, withdrawn_assignments integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $transport_reconciliation$
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
      SELECT CASE WHEN coalesce(
        request."matchingCoveragePurpose",
        CASE WHEN request."fulfilmentMode" IN ('SERVICE', 'INSTALLATION')
          THEN 'SERVICE'::bridge_ai."CoveragePurpose"
          ELSE 'DELIVERY'::bridge_ai."CoveragePurpose" END
      ) = 'SERVICE'
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
        OR coalesce(request."matchingLatitude", request."deliveryLatitude") IS NULL
        OR coalesce(request."matchingLongitude", request."deliveryLongitude") IS NULL
        OR bridge_private.distance_miles(
          origin_lat, origin_lng,
          coalesce(request."matchingLatitude", request."deliveryLatitude"),
          coalesce(request."matchingLongitude", request."deliveryLongitude")
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
$transport_reconciliation$;

REVOKE ALL ON FUNCTION bridge_private.reconcile_supplier_geographic_membership(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.reconcile_supplier_geographic_membership(text) TO bridge_ai_app;

CREATE OR REPLACE FUNCTION bridge_private.supplier_assignment_within_active_geography(
  target_assignment_id text,
  target_company_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $transport_geography$
  WITH assignment_location AS (
    SELECT
      assignment.id,
      assignment."supplierCompanyId",
      coalesce(request."matchingLatitude", request."deliveryLatitude") AS request_latitude,
      coalesce(request."matchingLongitude", request."deliveryLongitude") AS request_longitude,
      coalesce(
        request."matchingCoveragePurpose",
        CASE WHEN request."fulfilmentMode" IN ('SERVICE', 'INSTALLATION')
          THEN 'SERVICE'::bridge_ai."CoveragePurpose"
          ELSE 'DELIVERY'::bridge_ai."CoveragePurpose" END
      ) AS coverage_purpose
    FROM bridge_ai."SupplierAssignment" assignment
    JOIN bridge_ai."QuoteRequest" request
      ON request.id = assignment."quoteRequestId"
    WHERE assignment.id = target_assignment_id
      AND assignment."supplierCompanyId" = target_company_id
  ), entitlement AS (
    SELECT
      limits.nationwide,
      CASE
        WHEN limits.maximum_radius IS NULL THEN
          CASE WHEN assignment_location.coverage_purpose = 'SERVICE'
            THEN company."maximumServiceRadiusOverride"
            ELSE company."maximumDeliveryRadiusOverride"
          END
        WHEN assignment_location.coverage_purpose = 'SERVICE'
             AND company."maximumServiceRadiusOverride" IS NOT NULL
          THEN least(company."maximumServiceRadiusOverride", limits.maximum_radius)
        WHEN assignment_location.coverage_purpose = 'DELIVERY'
             AND company."maximumDeliveryRadiusOverride" IS NOT NULL
          THEN least(company."maximumDeliveryRadiusOverride", limits.maximum_radius)
        ELSE limits.maximum_radius
      END AS permitted_radius,
      company."geographicOriginLatitude" AS origin_latitude,
      company."geographicOriginLongitude" AS origin_longitude,
      assignment_location.request_latitude,
      assignment_location.request_longitude
    FROM assignment_location
    JOIN bridge_ai.supplier_companies company
      ON company.id = assignment_location."supplierCompanyId"
    CROSS JOIN LATERAL bridge_private.effective_membership_limits(company.id) limits
  )
  SELECT coalesce(bool_or(
    CASE
      WHEN entitlement.nationwide AND entitlement.permitted_radius IS NULL THEN true
      WHEN entitlement.permitted_radius IS NULL
        OR entitlement.origin_latitude IS NULL
        OR entitlement.origin_longitude IS NULL
        OR entitlement.request_latitude IS NULL
        OR entitlement.request_longitude IS NULL THEN false
      ELSE bridge_private.distance_miles(
        entitlement.origin_latitude,
        entitlement.origin_longitude,
        entitlement.request_latitude,
        entitlement.request_longitude
      ) <= entitlement.permitted_radius + 0.01
    END
  ), false)
  FROM entitlement;
$transport_geography$;

REVOKE ALL ON FUNCTION bridge_private.supplier_assignment_within_active_geography(text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.supplier_assignment_within_active_geography(text, text)
  TO authenticated, bridge_ai_app;
