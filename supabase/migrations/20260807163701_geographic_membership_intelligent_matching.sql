CREATE TYPE bridge_ai."CoveragePurpose" AS ENUM ('SERVICE', 'DELIVERY');
CREATE TYPE bridge_ai."MembershipTier" AS ENUM ('LOCAL', 'REGIONAL', 'NATIONWIDE');
CREATE TYPE bridge_ai."FulfilmentMode" AS ENUM ('SERVICE', 'INSTALLATION', 'SUPPLY_ONLY', 'DELIVERY', 'COLLECTION');
ALTER TYPE bridge_ai."SupplierCapacityStatus" ADD VALUE IF NOT EXISTS 'HOLIDAY';
ALTER TYPE bridge_ai."SupplierCapacityStatus" ADD VALUE IF NOT EXISTS 'NOT_ACCEPTING';

CREATE TABLE bridge_ai."MembershipPlan" (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  tier bridge_ai."MembershipTier" NOT NULL UNIQUE,
  description text,
  "monthlyPricePence" integer NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'GBP',
  "maximumRadiusMiles" integer,
  "nationwideAllowed" boolean NOT NULL DEFAULT false,
  "maximumActiveOpportunities" integer NOT NULL,
  "taxEnabled" boolean NOT NULL DEFAULT false,
  "providerProductId" text UNIQUE,
  "providerPriceId" text UNIQUE,
  active boolean NOT NULL DEFAULT true,
  "displayOrder" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_plan_price_positive CHECK ("monthlyPricePence" > 0),
  CONSTRAINT membership_plan_radius_valid CHECK (
    (tier IN ('LOCAL','REGIONAL') AND "maximumRadiusMiles" BETWEEN 1 AND 500 AND NOT "nationwideAllowed")
    OR (tier = 'NATIONWIDE' AND "nationwideAllowed")
  ),
  CONSTRAINT membership_plan_active_limit_valid CHECK ("maximumActiveOpportunities" BETWEEN 1 AND 100)
);

INSERT INTO bridge_ai."MembershipPlan" (
  id, code, name, tier, description, "monthlyPricePence", "maximumRadiusMiles",
  "nationwideAllowed", "maximumActiveOpportunities", "taxEnabled", "displayOrder"
) VALUES
  ('plan_local_partner', 'bridge-ai-local-partner', 'Local Partner', 'LOCAL', 'Suitable matched opportunities within a supplier-selected radius of up to 40 miles.', 2999, 40, false, 5, false, 10),
  ('plan_regional_partner', 'bridge-ai-regional-partner', 'Regional Partner', 'REGIONAL', 'Suitable matched opportunities within a supplier-selected radius of up to 100 miles.', 5999, 100, false, 10, false, 20),
  ('plan_nationwide_partner', 'bridge-ai-nationwide-partner', 'Nationwide Partner', 'NATIONWIDE', 'Suitable matched opportunities across Great Britain where capability and genuine coverage are confirmed.', 8999, NULL, true, 20, false, 30);

CREATE TABLE bridge_ai."MatchingConfiguration" (
  id text PRIMARY KEY DEFAULT 'default',
  "maximumSuppliersPerRequest" integer NOT NULL DEFAULT 3,
  "capacityStaleDays" integer NOT NULL DEFAULT 7,
  "leadTimeStaleDays" integer NOT NULL DEFAULT 14,
  "responseDeadlineHours" integer NOT NULL DEFAULT 8,
  "automaticNextSupplierInvitation" boolean NOT NULL DEFAULT true,
  "serviceMatchingEnabled" boolean NOT NULL DEFAULT true,
  "deliveryMatchingEnabled" boolean NOT NULL DEFAULT true,
  "matchingWeights" jsonb NOT NULL,
  "updatedById" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matching_max_suppliers_valid CHECK ("maximumSuppliersPerRequest" BETWEEN 1 AND 3),
  CONSTRAINT matching_stale_days_valid CHECK ("capacityStaleDays" BETWEEN 1 AND 90 AND "leadTimeStaleDays" BETWEEN 1 AND 90),
  CONSTRAINT matching_deadline_valid CHECK ("responseDeadlineHours" BETWEEN 1 AND 168)
);

INSERT INTO bridge_ai."MatchingConfiguration" (id, "responseDeadlineHours", "matchingWeights") VALUES
('default', 8, '{"capability":35,"leadTime":20,"capacity":15,"coverage":12,"locality":8,"response":5,"completion":3,"reliability":2}'::jsonb);

CREATE TABLE bridge_ai."MembershipPromotion" (
  id text PRIMARY KEY,
  name text NOT NULL,
  "eligiblePlanCodes" text[] NOT NULL DEFAULT '{}',
  "promotionalPricePence" integer NOT NULL,
  "durationMonths" integer NOT NULL,
  "subscriberLimit" integer,
  "startsAt" timestamptz NOT NULL,
  "endsAt" timestamptz,
  "existingSubscribersQualify" boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT false,
  "providerCouponIds" jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_price_valid CHECK ("promotionalPricePence" > 0),
  CONSTRAINT promotion_duration_valid CHECK ("durationMonths" BETWEEN 1 AND 36),
  CONSTRAINT promotion_limit_valid CHECK ("subscriberLimit" IS NULL OR "subscriberLimit" > 0),
  CONSTRAINT promotion_dates_valid CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt")
);

ALTER TABLE bridge_ai."Subscription"
  ADD COLUMN "membershipPlanId" text,
  ADD COLUMN "promotionId" text,
  ADD CONSTRAINT "Subscription_membershipPlanId_fkey"
    FOREIGN KEY ("membershipPlanId") REFERENCES bridge_ai."MembershipPlan"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Subscription_promotionId_fkey"
    FOREIGN KEY ("promotionId") REFERENCES bridge_ai."MembershipPromotion"(id) ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE bridge_ai."Subscription" SET "membershipPlanId" = 'plan_local_partner' WHERE "membershipPlanId" IS NULL;
CREATE INDEX "Subscription_membershipPlanId_status_idx" ON bridge_ai."Subscription" ("membershipPlanId", status);
CREATE INDEX "Subscription_promotionId_status_idx" ON bridge_ai."Subscription" ("promotionId", status);

CREATE OR REPLACE FUNCTION bridge_private.enforce_membership_promotion_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  promotion bridge_ai."MembershipPromotion"%ROWTYPE;
  claims integer;
BEGIN
  IF NEW."promotionId" IS NULL OR NEW.status NOT IN ('ACTIVE','TRIALING','PAST_DUE') THEN RETURN NEW; END IF;
  SELECT * INTO promotion FROM bridge_ai."MembershipPromotion" WHERE id=NEW."promotionId" FOR UPDATE;
  IF NOT FOUND OR NOT promotion.active OR promotion."startsAt">now() OR (promotion."endsAt" IS NOT NULL AND promotion."endsAt"<=now()) THEN
    RAISE EXCEPTION 'membership promotion is not active' USING ERRCODE='23514';
  END IF;
  IF NOT (NEW."planCode" = ANY(promotion."eligiblePlanCodes")) THEN
    RAISE EXCEPTION 'membership promotion is not valid for this plan' USING ERRCODE='23514';
  END IF;
  IF promotion."subscriberLimit" IS NOT NULL THEN
    SELECT count(*) INTO claims FROM bridge_ai."Subscription"
    WHERE "promotionId"=promotion.id AND status IN ('ACTIVE','TRIALING','PAST_DUE') AND id<>NEW.id;
    IF claims >= promotion."subscriberLimit" THEN
      RAISE EXCEPTION 'membership promotion subscriber limit reached' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.enforce_membership_promotion_claim() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_membership_promotion_claim
  BEFORE INSERT OR UPDATE OF "promotionId", status, "planCode" ON bridge_ai."Subscription"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_membership_promotion_claim();

-- The old first-100 approval allocation is retained as historical data only.
-- Geographic membership and promotions now control access, so supplier approval
-- must never fail merely because an old founding counter reached 100.
DROP TRIGGER IF EXISTS allocate_founding_supplier_place ON bridge_ai.supplier_companies;

CREATE OR REPLACE FUNCTION bridge_private.enforce_payment_gated_quotation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'SUBMITTED' AND (OLD.status IS DISTINCT FROM NEW.status) AND NOT EXISTS (
    SELECT 1
    FROM bridge_ai.supplier_companies company
    JOIN bridge_ai."Subscription" subscription
      ON subscription."supplierCompanyId" = company.id
    WHERE company.id = NEW."supplierCompanyId"
      AND company.status = 'APPROVED'
      AND subscription.status = 'ACTIVE'
      AND (subscription."currentPeriodEnd" IS NULL OR subscription."currentPeriodEnd" > now())
  ) THEN
    RAISE EXCEPTION 'an active geographic supplier membership is required to submit a quotation' USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('SELECTED_PENDING_PAYMENT', 'ACCEPTED')
    AND OLD.status IS DISTINCT FROM NEW.status
    AND NOT bridge_private.is_platform_admin()
    AND coalesce(current_setting('bridge_ai.payment_transition', true), '') <> 'on' THEN
    RAISE EXCEPTION 'customer selection transitions are server controlled' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE bridge_ai.supplier_companies
  ADD COLUMN "geographicOriginPostcode" text,
  ADD COLUMN "geographicOriginLatitude" numeric(9,6),
  ADD COLUMN "geographicOriginLongitude" numeric(9,6),
  ADD COLUMN "membershipTierOverride" bridge_ai."MembershipTier",
  ADD COLUMN "maximumActiveOpportunitiesOverride" integer,
  ADD COLUMN "maximumServiceRadiusOverride" integer,
  ADD COLUMN "maximumDeliveryRadiusOverride" integer,
  ADD CONSTRAINT supplier_geographic_coordinates_together CHECK (
    ("geographicOriginLatitude" IS NULL AND "geographicOriginLongitude" IS NULL)
    OR ("geographicOriginLatitude" IS NOT NULL AND "geographicOriginLongitude" IS NOT NULL)
  ),
  ADD CONSTRAINT supplier_active_override_valid CHECK ("maximumActiveOpportunitiesOverride" IS NULL OR "maximumActiveOpportunitiesOverride" BETWEEN 1 AND 100),
  ADD CONSTRAINT supplier_service_override_valid CHECK ("maximumServiceRadiusOverride" IS NULL OR "maximumServiceRadiusOverride" BETWEEN 1 AND 500),
  ADD CONSTRAINT supplier_delivery_override_valid CHECK ("maximumDeliveryRadiusOverride" IS NULL OR "maximumDeliveryRadiusOverride" BETWEEN 1 AND 500);

UPDATE bridge_ai.supplier_companies
SET "geographicOriginPostcode" = postcode
WHERE "geographicOriginPostcode" IS NULL AND postcode IS NOT NULL;

DROP INDEX IF EXISTS bridge_ai."CoverageArea_supplierCompanyId_active_idx";
DROP INDEX IF EXISTS bridge_ai.coverage_one_active_nationwide_per_company;
ALTER TABLE bridge_ai."CoverageArea"
  ADD COLUMN purpose bridge_ai."CoveragePurpose" NOT NULL DEFAULT 'DELIVERY';
CREATE INDEX "CoverageArea_supplierCompanyId_purpose_active_idx"
  ON bridge_ai."CoverageArea" ("supplierCompanyId", purpose, active);
CREATE UNIQUE INDEX coverage_one_active_nationwide_per_company_purpose
  ON bridge_ai."CoverageArea" ("supplierCompanyId", purpose)
  WHERE type = 'NATIONWIDE' AND active;

CREATE TABLE bridge_ai."CollectionLocation" (
  id text PRIMARY KEY,
  "supplierCompanyId" text NOT NULL REFERENCES bridge_ai.supplier_companies(id) ON DELETE CASCADE ON UPDATE CASCADE,
  label text NOT NULL,
  postcode text NOT NULL,
  latitude numeric(9,6) NOT NULL,
  longitude numeric(9,6) NOT NULL,
  "collectionDays" integer[] NOT NULL DEFAULT '{}',
  "noticeRequired" boolean NOT NULL DEFAULT false,
  "noticeHours" integer,
  active boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_days_valid CHECK ("collectionDays" <@ ARRAY[1,2,3,4,5,6,7]),
  CONSTRAINT collection_notice_valid CHECK ((NOT "noticeRequired" AND "noticeHours" IS NULL) OR ("noticeRequired" AND "noticeHours" BETWEEN 1 AND 720))
);
CREATE INDEX "CollectionLocation_supplierCompanyId_active_idx" ON bridge_ai."CollectionLocation" ("supplierCompanyId", active);
CREATE INDEX "CollectionLocation_postcode_idx" ON bridge_ai."CollectionLocation" (postcode);

ALTER TABLE bridge_ai."SupplierCapability"
  ADD COLUMN "currentLeadTimeDays" integer,
  ADD COLUMN "supportsSupplyOnly" boolean NOT NULL DEFAULT true,
  ADD COLUMN "supportsDelivery" boolean NOT NULL DEFAULT true,
  ADD COLUMN "supportsInstallation" boolean NOT NULL DEFAULT false,
  ADD COLUMN "supportsService" boolean NOT NULL DEFAULT false,
  ADD COLUMN "capacityLastConfirmedAt" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN "leadTimeLastConfirmedAt" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN "restrictedProducts" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN "deliveryDelayDays" integer,
  ADD CONSTRAINT capability_current_lead_time_valid CHECK ("currentLeadTimeDays" IS NULL OR "currentLeadTimeDays" BETWEEN 1 AND 730),
  ADD CONSTRAINT capability_delivery_delay_valid CHECK ("deliveryDelayDays" IS NULL OR "deliveryDelayDays" BETWEEN 0 AND 365);
UPDATE bridge_ai."SupplierCapability"
SET "currentLeadTimeDays" = "standardLeadTimeDays",
    "capacityLastConfirmedAt" = "lastConfirmedAt",
    "leadTimeLastConfirmedAt" = "lastConfirmedAt";

ALTER TABLE bridge_ai."QuoteRequest"
  ADD COLUMN "fulfilmentMode" bridge_ai."FulfilmentMode" NOT NULL DEFAULT 'DELIVERY';
UPDATE bridge_ai."QuoteRequest" SET "fulfilmentMode" = 'COLLECTION' WHERE "collectionRequired";

ALTER TABLE bridge_ai."SupplierMatchDecision"
  ADD COLUMN "membershipTier" bridge_ai."MembershipTier",
  ADD COLUMN "coveragePurpose" bridge_ai."CoveragePurpose",
  ADD COLUMN "distanceMiles" numeric(8,2),
  ADD COLUMN "rankingSnapshot" jsonb;

ALTER TABLE bridge_ai."SupplierAssignment"
  ADD COLUMN "invitationRank" integer NOT NULL DEFAULT 1,
  ADD COLUMN "replacementForId" text,
  ADD CONSTRAINT "SupplierAssignment_replacementForId_fkey"
    FOREIGN KEY ("replacementForId") REFERENCES bridge_ai."SupplierAssignment"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT assignment_invitation_rank_valid CHECK ("invitationRank" BETWEEN 1 AND 1000);
CREATE INDEX "SupplierAssignment_replacementForId_idx" ON bridge_ai."SupplierAssignment" ("replacementForId");

CREATE OR REPLACE FUNCTION bridge_private.effective_membership_limits(target_company_id text)
RETURNS TABLE(tier bridge_ai."MembershipTier", maximum_radius integer, nationwide boolean, maximum_active integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    COALESCE(company."membershipTierOverride", plan.tier),
    CASE
      WHEN company."membershipTierOverride" = 'NATIONWIDE' THEN NULL
      WHEN company."membershipTierOverride" = 'REGIONAL' THEN 100
      WHEN company."membershipTierOverride" = 'LOCAL' THEN 40
      ELSE plan."maximumRadiusMiles"
    END,
    COALESCE(company."membershipTierOverride" = 'NATIONWIDE', plan."nationwideAllowed", false),
    COALESCE(company."maximumActiveOpportunitiesOverride", plan."maximumActiveOpportunities", 0)
  FROM bridge_ai.supplier_companies company
  LEFT JOIN bridge_ai."Subscription" subscription
    ON subscription."supplierCompanyId" = company.id
   AND subscription.status = 'ACTIVE'
   AND (subscription."currentPeriodEnd" IS NULL OR subscription."currentPeriodEnd" > now())
  LEFT JOIN bridge_ai."MembershipPlan" plan ON plan.id = subscription."membershipPlanId" AND plan.active
  WHERE company.id = target_company_id;
$$;
REVOKE ALL ON FUNCTION bridge_private.effective_membership_limits(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION bridge_private.effective_membership_limits(text) TO bridge_ai_app;

CREATE OR REPLACE FUNCTION bridge_private.enforce_coverage_membership_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE limits record; permitted integer; origin_lat numeric; origin_lng numeric; centre_distance numeric;
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;
  SELECT * INTO limits FROM bridge_private.effective_membership_limits(NEW."supplierCompanyId");
  IF limits.tier IS NULL THEN
    RAISE EXCEPTION 'an active geographic membership is required to configure coverage' USING ERRCODE = '23514';
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
    RAISE EXCEPTION 'coverage radius exceeds the active membership limit' USING ERRCODE = '23514';
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
      RAISE EXCEPTION 'coverage boundary exceeds the membership radius from the company base' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.enforce_coverage_membership_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_coverage_membership_limit ON bridge_ai."CoverageArea";
CREATE TRIGGER enforce_coverage_membership_limit
  BEFORE INSERT OR UPDATE OF active, type, purpose, "radiusMiles", "supplierCompanyId"
  ON bridge_ai."CoverageArea" FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_coverage_membership_limit();

CREATE OR REPLACE FUNCTION bridge_private.enforce_automatic_assignment_limits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE limits record; request_limit integer; request_active integer; supplier_active integer;
BEGIN
  IF NEW.status NOT IN ('PENDING','VIEWED','ACCEPTED') OR NEW."assignedById" IS NOT NULL THEN RETURN NEW; END IF;
  SELECT LEAST(request."distributionLimit", config."maximumSuppliersPerRequest")
    INTO request_limit
  FROM bridge_ai."QuoteRequest" request
  CROSS JOIN bridge_ai."MatchingConfiguration" config
  WHERE request.id = NEW."quoteRequestId" AND config.id='default';
  SELECT count(*) INTO request_active FROM bridge_ai."SupplierAssignment"
  WHERE "quoteRequestId"=NEW."quoteRequestId" AND status IN ('PENDING','VIEWED','ACCEPTED') AND id<>NEW.id;
  IF request_active >= COALESCE(request_limit, 3) THEN
    RAISE EXCEPTION 'automatic assignment would exceed the active supplier limit' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO limits FROM bridge_private.effective_membership_limits(NEW."supplierCompanyId");
  SELECT count(*) INTO supplier_active FROM bridge_ai."SupplierAssignment" assignment
  JOIN bridge_ai."QuoteRequest" request ON request.id=assignment."quoteRequestId"
  WHERE assignment."supplierCompanyId"=NEW."supplierCompanyId"
    AND assignment.status IN ('PENDING','VIEWED','ACCEPTED')
    AND request.status IN ('OPEN','MATCHING','QUOTED') AND assignment.id<>NEW.id;
  IF limits.maximum_active IS NULL OR limits.maximum_active < 1 OR supplier_active >= limits.maximum_active THEN
    RAISE EXCEPTION 'supplier active opportunity limit reached' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.enforce_automatic_assignment_limits() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_automatic_assignment_limits ON bridge_ai."SupplierAssignment";
CREATE TRIGGER enforce_automatic_assignment_limits
  BEFORE INSERT OR UPDATE OF status, "supplierCompanyId", "quoteRequestId", "assignedById"
  ON bridge_ai."SupplierAssignment" FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_automatic_assignment_limits();

ALTER TABLE bridge_ai."MembershipPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."MembershipPlan" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."MatchingConfiguration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."MatchingConfiguration" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."MembershipPromotion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."MembershipPromotion" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."CollectionLocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."CollectionLocation" FORCE ROW LEVEL SECURITY;

GRANT SELECT ON bridge_ai."MembershipPlan", bridge_ai."MatchingConfiguration" TO authenticated, bridge_ai_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bridge_ai."MembershipPromotion", bridge_ai."CollectionLocation" TO authenticated, bridge_ai_app;
GRANT INSERT, UPDATE, DELETE ON bridge_ai."MembershipPlan", bridge_ai."MatchingConfiguration" TO bridge_ai_app;
REVOKE ALL ON bridge_ai."MembershipPlan", bridge_ai."MatchingConfiguration", bridge_ai."MembershipPromotion", bridge_ai."CollectionLocation" FROM PUBLIC, anon, service_role;

CREATE POLICY membership_plan_authenticated_read ON bridge_ai."MembershipPlan"
  FOR SELECT TO authenticated USING (active OR (SELECT bridge_private.is_platform_admin()));
CREATE POLICY membership_plan_admin_manage ON bridge_ai."MembershipPlan"
  FOR ALL TO authenticated USING ((SELECT bridge_private.is_platform_admin())) WITH CHECK ((SELECT bridge_private.is_platform_admin()));
CREATE POLICY membership_plan_stripe_worker_update ON bridge_ai."MembershipPlan"
  FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('stripe_billing')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('stripe_billing')));
CREATE POLICY matching_config_authenticated_read ON bridge_ai."MatchingConfiguration"
  FOR SELECT TO authenticated USING (true);
CREATE POLICY matching_config_admin_manage ON bridge_ai."MatchingConfiguration"
  FOR ALL TO authenticated USING ((SELECT bridge_private.is_platform_admin())) WITH CHECK ((SELECT bridge_private.is_platform_admin()));
CREATE POLICY promotion_admin_manage ON bridge_ai."MembershipPromotion"
  FOR ALL TO authenticated USING ((SELECT bridge_private.is_platform_admin())) WITH CHECK ((SELECT bridge_private.is_platform_admin()));
CREATE POLICY promotion_stripe_worker_update ON bridge_ai."MembershipPromotion"
  FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('stripe_billing')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('stripe_billing')));
CREATE POLICY collection_location_company_read ON bridge_ai."CollectionLocation"
  FOR SELECT TO authenticated USING ((SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.has_company_membership("supplierCompanyId")));
CREATE POLICY collection_location_company_manage ON bridge_ai."CollectionLocation"
  FOR ALL TO authenticated USING ((SELECT bridge_private.has_company_membership("supplierCompanyId")))
  WITH CHECK ((SELECT bridge_private.has_company_membership("supplierCompanyId")));

COMMENT ON TABLE bridge_ai."MembershipPlan" IS 'Administrator-configurable geographic supplier membership tiers and Stripe price mapping.';
COMMENT ON TABLE bridge_ai."MatchingConfiguration" IS 'Trusted matching limits and weights; browser inputs cannot override these values.';
COMMENT ON COLUMN bridge_ai."CoverageArea".purpose IS 'Separates on-site service travel from product delivery coverage.';
COMMENT ON TABLE bridge_ai."CollectionLocation" IS 'Supplier collection depots, available days and notice requirements.';
