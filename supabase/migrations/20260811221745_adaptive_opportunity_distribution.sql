-- Adaptive opportunity distribution: request-specific density, exposure-aware
-- ranking, soft membership caps in thin markets and auditable coverage gaps.

CREATE TYPE bridge_ai."MarketDensityMode" AS ENUM ('EMPTY', 'SPARSE', 'HEALTHY', 'DENSE');

ALTER TABLE bridge_ai."MatchingConfiguration"
  ADD COLUMN "acknowledgementDeadlineHours" integer NOT NULL DEFAULT 6,
  ADD COLUMN "quotationDeadlineHours" integer NOT NULL DEFAULT 24,
  ADD COLUMN "sparseMarketMaximumEligible" integer NOT NULL DEFAULT 4,
  ADD COLUMN "healthyMarketMaximumEligible" integer NOT NULL DEFAULT 10,
  ADD COLUMN "sparseFairnessWeight" integer NOT NULL DEFAULT 2,
  ADD COLUMN "healthyFairnessWeight" integer NOT NULL DEFAULT 5,
  ADD COLUMN "denseFairnessWeight" integer NOT NULL DEFAULT 10,
  ADD COLUMN "fairnessSimilarityBandPoints" integer NOT NULL DEFAULT 5,
  ADD COLUMN "sparseSoftCapEnabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN "healthySoftCapExtraOpportunities" integer NOT NULL DEFAULT 1,
  ADD COLUMN "respectDeclaredMonthlyCapacity" boolean NOT NULL DEFAULT true,
  ADD COLUMN "declaredCapacityWarningPercent" integer NOT NULL DEFAULT 80,
  ADD COLUMN "coverageGapAlertsEnabled" boolean NOT NULL DEFAULT true;

ALTER TABLE bridge_ai."MatchingConfiguration"
  ADD CONSTRAINT matching_density_thresholds_valid CHECK (
    "sparseMarketMaximumEligible" BETWEEN 1 AND 4
    AND "healthyMarketMaximumEligible" BETWEEN "sparseMarketMaximumEligible" + 1 AND 100
  ),
  ADD CONSTRAINT matching_fairness_weights_valid CHECK (
    "sparseFairnessWeight" BETWEEN 0 AND 2
    AND "healthyFairnessWeight" BETWEEN 3 AND 7
    AND "denseFairnessWeight" BETWEEN 5 AND 12
    AND "fairnessSimilarityBandPoints" BETWEEN 1 AND 20
  ),
  ADD CONSTRAINT matching_adaptive_limits_valid CHECK (
    "healthySoftCapExtraOpportunities" BETWEEN 0 AND 10
    AND "declaredCapacityWarningPercent" BETWEEN 50 AND 100
  ),
  ADD CONSTRAINT matching_adaptive_deadlines_valid CHECK (
    "acknowledgementDeadlineHours" BETWEEN 1 AND 168
    AND "quotationDeadlineHours" BETWEEN 1 AND 336
  );

UPDATE bridge_ai."MembershipPlan"
SET "maximumActiveOpportunities" = CASE tier
  WHEN 'HYPERLOCAL'::bridge_ai."MembershipTier" THEN 5
  WHEN 'LOCAL'::bridge_ai."MembershipTier" THEN 10
  WHEN 'REGIONAL'::bridge_ai."MembershipTier" THEN 20
  WHEN 'NATIONWIDE'::bridge_ai."MembershipTier" THEN 30
END,
"updatedAt" = now();

ALTER TABLE bridge_ai."SupplierCapability"
  ADD COLUMN "declaredMonthlyCapacity" integer;
ALTER TABLE bridge_ai."SupplierCapability"
  ADD CONSTRAINT capability_declared_monthly_capacity_valid CHECK (
    "declaredMonthlyCapacity" IS NULL OR "declaredMonthlyCapacity" BETWEEN 1 AND 100000
  );

ALTER TABLE bridge_ai."QuoteRequest"
  ADD COLUMN "marketDensityMode" bridge_ai."MarketDensityMode",
  ADD COLUMN "consideredSupplierCount" integer NOT NULL DEFAULT 0,
  ADD COLUMN "eliminatedSupplierCount" integer NOT NULL DEFAULT 0,
  ADD COLUMN "eligibleSupplierCount" integer NOT NULL DEFAULT 0,
  ADD COLUMN "invitedSupplierCount" integer NOT NULL DEFAULT 0,
  ADD COLUMN "fairnessInfluence" text,
  ADD COLUMN "matchingEvaluatedAt" timestamptz;
ALTER TABLE bridge_ai."QuoteRequest"
  ADD CONSTRAINT quote_request_matching_counts_valid CHECK (
    "consideredSupplierCount" >= 0 AND "eliminatedSupplierCount" >= 0
    AND "eligibleSupplierCount" >= 0 AND "invitedSupplierCount" BETWEEN 0 AND 5
    AND "eliminatedSupplierCount" + "eligibleSupplierCount" <= "consideredSupplierCount"
  );

ALTER TABLE bridge_ai."SupplierMatchDecision"
  ADD COLUMN "baseScore" integer NOT NULL DEFAULT 0,
  ADD COLUMN "fairnessAdjustment" numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "marketDensityMode" bridge_ai."MarketDensityMode",
  ADD COLUMN "invitationReason" text,
  ADD COLUMN "rejectionReason" text;
ALTER TABLE bridge_ai."SupplierMatchDecision"
  ADD CONSTRAINT supplier_match_base_score_valid CHECK ("baseScore" BETWEEN 0 AND 100),
  ADD CONSTRAINT supplier_match_fairness_adjustment_valid CHECK ("fairnessAdjustment" BETWEEN 0 AND 12);

ALTER TABLE bridge_ai."SupplierAssignment"
  ADD COLUMN "marketDensityMode" bridge_ai."MarketDensityMode",
  ADD COLUMN "softCapOverride" boolean NOT NULL DEFAULT false,
  ADD COLUMN "capacityOverride" boolean NOT NULL DEFAULT false;

CREATE TABLE bridge_ai."CoverageGapSignal" (
  id text PRIMARY KEY,
  "quoteRequestId" text NOT NULL UNIQUE REFERENCES bridge_ai."QuoteRequest"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "categoryId" text NOT NULL REFERENCES bridge_ai."ProductCategory"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "deliveryOutwardCode" varchar(12) NOT NULL,
  "eligibleSupplierCount" integer NOT NULL,
  "marketDensityMode" bridge_ai."MarketDensityMode" NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'OPEN',
  "firstDetectedAt" timestamptz NOT NULL DEFAULT now(),
  "lastDetectedAt" timestamptz NOT NULL DEFAULT now(),
  "resolvedAt" timestamptz,
  CONSTRAINT coverage_gap_eligible_count_valid CHECK ("eligibleSupplierCount" BETWEEN 0 AND 2),
  CONSTRAINT coverage_gap_status_valid CHECK (status IN ('OPEN', 'RESOLVED')),
  CONSTRAINT coverage_gap_resolution_valid CHECK ((status = 'OPEN' AND "resolvedAt" IS NULL) OR (status = 'RESOLVED' AND "resolvedAt" IS NOT NULL))
);
CREATE INDEX "CoverageGapSignal_categoryId_deliveryOutwardCode_firstDetectedAt_idx"
  ON bridge_ai."CoverageGapSignal" ("categoryId", "deliveryOutwardCode", "firstDetectedAt");
CREATE INDEX "CoverageGapSignal_status_eligibleSupplierCount_firstDetectedAt_idx"
  ON bridge_ai."CoverageGapSignal" (status, "eligibleSupplierCount", "firstDetectedAt");

ALTER TABLE bridge_ai."CoverageGapSignal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."CoverageGapSignal" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON bridge_ai."CoverageGapSignal" TO authenticated, bridge_ai_app;
REVOKE ALL ON bridge_ai."CoverageGapSignal" FROM PUBLIC, anon, service_role;
CREATE POLICY coverage_gap_admin_read ON bridge_ai."CoverageGapSignal"
  FOR SELECT TO authenticated USING ((SELECT bridge_private.is_platform_admin()));
CREATE POLICY coverage_gap_worker_manage ON bridge_ai."CoverageGapSignal"
  FOR ALL TO authenticated
  USING ((SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')))
  WITH CHECK ((SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')));

CREATE OR REPLACE FUNCTION bridge_private.enforce_automatic_assignment_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  limits record;
  settings record;
  density bridge_ai."MarketDensityMode";
  request_limit integer;
  request_active integer;
  supplier_active integer;
  request_lat numeric;
  request_lng numeric;
  request_mode bridge_ai."FulfilmentMode";
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

  -- Serialize both sides of the invariant. Request and supplier counts may be
  -- updated concurrently by WhatsApp workers, replacements and administrators.
  PERFORM pg_advisory_xact_lock(hashtextextended('request:' || NEW."quoteRequestId", 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('supplier:' || NEW."supplierCompanyId", 0));

  SELECT configuration.* INTO settings
  FROM bridge_ai."MatchingConfiguration" configuration
  WHERE configuration.id = 'default';

  SELECT
    least(request."distributionLimit", settings."maximumSuppliersPerRequest", 5),
    request."deliveryLatitude", request."deliveryLongitude", request."fulfilmentMode",
    request."categoryId", request."marketDensityMode"
  INTO request_limit, request_lat, request_lng, request_mode, request_category, density
  FROM bridge_ai."QuoteRequest" request
  WHERE request.id = NEW."quoteRequestId";

  IF request_limit IS NULL THEN
    RAISE EXCEPTION 'quote request or matching configuration is unavailable' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO request_active
  FROM bridge_ai."SupplierAssignment"
  WHERE "quoteRequestId" = NEW."quoteRequestId"
    AND status IN ('PENDING', 'VIEWED', 'ACCEPTED') AND id <> NEW.id;
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
    AND request.status IN ('OPEN', 'MATCHING', 'QUOTED') AND assignment.id <> NEW.id;

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

  SELECT company."geographicOriginLatitude", company."geographicOriginLongitude",
    CASE WHEN request_mode IN ('SERVICE', 'INSTALLATION')
      THEN company."maximumServiceRadiusOverride" ELSE company."maximumDeliveryRadiusOverride" END
  INTO origin_lat, origin_lng, configured_override
  FROM bridge_ai.supplier_companies company WHERE company.id = NEW."supplierCompanyId";

  permitted := CASE WHEN limits.maximum_radius IS NULL THEN configured_override
    WHEN configured_override IS NULL THEN limits.maximum_radius
    ELSE least(configured_override, limits.maximum_radius) END;
  IF NOT limits.nationwide OR permitted IS NOT NULL THEN
    IF permitted IS NULL OR origin_lat IS NULL OR origin_lng IS NULL OR request_lat IS NULL OR request_lng IS NULL THEN
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
  BEFORE INSERT OR UPDATE OF status, "quoteRequestId", "supplierCompanyId", "assignedById", "capacityOverride"
  ON bridge_ai."SupplierAssignment"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_automatic_assignment_limits();

COMMENT ON COLUMN bridge_ai."QuoteRequest"."marketDensityMode" IS
  'Request-specific density after mandatory eligibility filters; never a platform-wide label.';
COMMENT ON COLUMN bridge_ai."SupplierAssignment"."softCapOverride" IS
  'True only when a sparse-market invitation legitimately exceeds the membership normal active-opportunity limit.';
COMMENT ON TABLE bridge_ai."CoverageGapSignal" IS
  'Admin-only recruitment intelligence for requests with zero, one or two eligible suppliers.';
