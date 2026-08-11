-- Add a deliberately limited entry membership without weakening the existing
-- geographic, subscription, capability or supplier-count boundaries.

ALTER TYPE bridge_ai."MembershipTier" ADD VALUE IF NOT EXISTS 'HYPERLOCAL' BEFORE 'LOCAL';
COMMIT;

ALTER TABLE bridge_ai."ProductCategory"
  ADD COLUMN IF NOT EXISTS "hyperlocalEnabled" boolean NOT NULL DEFAULT false;

UPDATE bridge_ai."ProductCategory"
SET "hyperlocalEnabled" = true,
    "updatedAt" = now()
WHERE "parentId" IS NULL
  AND slug IN ('windows', 'transport-delivery-removals');

ALTER TABLE bridge_ai."MembershipPlan"
  DROP CONSTRAINT IF EXISTS membership_plan_radius_valid;
ALTER TABLE bridge_ai."MembershipPlan"
  ADD CONSTRAINT membership_plan_radius_valid CHECK (
    (tier = 'HYPERLOCAL' AND "maximumRadiusMiles" BETWEEN 1 AND 10 AND NOT "nationwideAllowed")
    OR (tier = 'LOCAL' AND "maximumRadiusMiles" = 40 AND NOT "nationwideAllowed")
    OR (tier = 'REGIONAL' AND "maximumRadiusMiles" = 100 AND NOT "nationwideAllowed")
    OR (tier = 'NATIONWIDE' AND "maximumRadiusMiles" IS NULL AND "nationwideAllowed")
  );

INSERT INTO bridge_ai."MembershipPlan" (
  id, code, name, tier, description, "monthlyPricePence", currency,
  "maximumRadiusMiles", "nationwideAllowed", "maximumActiveOpportunities",
  "taxEnabled", active, "displayOrder", "createdAt", "updatedAt"
) VALUES (
  'plan_hyperlocal_partner',
  'bridge-ai-hyperlocal-partner',
  'Hyperlocal Partner',
  'HYPERLOCAL',
  'Suitable matched opportunities within a supplier-selected radius of 1 to 10 miles.',
  1499,
  'GBP',
  10,
  false,
  3,
  false,
  true,
  5,
  now(),
  now()
) ON CONFLICT (tier) DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  "monthlyPricePence" = EXCLUDED."monthlyPricePence",
  currency = EXCLUDED.currency,
  "maximumRadiusMiles" = EXCLUDED."maximumRadiusMiles",
  "nationwideAllowed" = false,
  "taxEnabled" = false,
  active = EXCLUDED.active,
  "displayOrder" = EXCLUDED."displayOrder",
  "updatedAt" = now();

UPDATE bridge_ai."MembershipPlan"
SET "displayOrder" = CASE tier
  WHEN 'HYPERLOCAL' THEN 5
  WHEN 'LOCAL' THEN 10
  WHEN 'REGIONAL' THEN 20
  WHEN 'NATIONWIDE' THEN 30
END,
"updatedAt" = now();

ALTER TABLE bridge_ai."MatchingConfiguration"
  DROP CONSTRAINT IF EXISTS matching_max_suppliers_valid;
ALTER TABLE bridge_ai."MatchingConfiguration"
  ADD CONSTRAINT matching_max_suppliers_valid CHECK ("maximumSuppliersPerRequest" BETWEEN 1 AND 5);
ALTER TABLE bridge_ai."MatchingConfiguration"
  ALTER COLUMN "maximumSuppliersPerRequest" SET DEFAULT 5;
UPDATE bridge_ai."MatchingConfiguration"
SET "maximumSuppliersPerRequest" = 5,
    "updatedAt" = now()
WHERE id = 'default';

ALTER TABLE bridge_ai."QuoteRequest"
  ALTER COLUMN "distributionLimit" SET DEFAULT 5;

CREATE INDEX IF NOT EXISTS product_category_hyperlocal_enabled_idx
  ON bridge_ai."ProductCategory" ("hyperlocalEnabled", active, "displayOrder")
  WHERE "parentId" IS NULL;

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
      WHEN 'HYPERLOCAL' THEN least(CASE WHEN purchased.tier = 'HYPERLOCAL' THEN purchased."maximumRadiusMiles" ELSE 10 END, 10)
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

CREATE OR REPLACE FUNCTION bridge_private.enforce_hyperlocal_industry_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  limits record;
  industry_enabled boolean;
BEGIN
  IF NEW.status NOT IN ('PENDING', 'VIEWED', 'ACCEPTED') THEN RETURN NEW; END IF;

  SELECT * INTO limits
  FROM bridge_private.effective_membership_limits(NEW."supplierCompanyId");

  IF limits.tier = 'HYPERLOCAL' THEN
    SELECT coalesce(parent."hyperlocalEnabled", category."hyperlocalEnabled", false)
      INTO industry_enabled
    FROM bridge_ai."QuoteRequest" request
    JOIN bridge_ai."ProductCategory" category ON category.id = request."categoryId"
    LEFT JOIN bridge_ai."ProductCategory" parent ON parent.id = category."parentId"
    WHERE request.id = NEW."quoteRequestId";

    IF NOT coalesce(industry_enabled, false) THEN
      RAISE EXCEPTION 'hyperlocal membership is not enabled for this request industry'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_hyperlocal_industry_assignment()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.enforce_hyperlocal_industry_assignment() TO bridge_ai_app;

DROP TRIGGER IF EXISTS enforce_hyperlocal_industry_assignment ON bridge_ai."SupplierAssignment";
CREATE TRIGGER enforce_hyperlocal_industry_assignment
  BEFORE INSERT OR UPDATE OF status, "quoteRequestId", "supplierCompanyId"
  ON bridge_ai."SupplierAssignment"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_hyperlocal_industry_assignment();

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'system_hyperlocal_membership_20260811210920',
  'SYSTEM.HYPERLOCAL_MEMBERSHIP_ADDED',
  'SecurityConfiguration',
  'hyperlocal-membership',
  'Added the configurable Hyperlocal Partner membership with strict industry and ten-mile boundaries',
  jsonb_build_object(
    'pricePence', 1499,
    'maximumRadiusMiles', 10,
    'industryControlled', true,
    'maximumSuppliersPerRequest', 5,
    'stripePriceServerSide', true
  ),
  now()
) ON CONFLICT (id) DO NOTHING;
