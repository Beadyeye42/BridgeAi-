CREATE TYPE bridge_ai."SupplierCapacityStatus" AS ENUM (
  'AVAILABLE', 'LIMITED', 'URGENT_ONLY', 'FULL', 'PAUSED'
);

CREATE TYPE bridge_ai."SupplierMatchOutcome" AS ENUM ('MATCHED', 'REJECTED');

ALTER TABLE bridge_ai."QuoteRequest"
  ADD COLUMN "requiredManufacturer" text,
  ADD COLUMN "requiredSystem" text,
  ADD COLUMN "requiredColour" text,
  ADD COLUMN "requiredFinish" text,
  ADD COLUMN "requiredBy" timestamptz(3),
  ADD COLUMN "collectionRequired" boolean NOT NULL DEFAULT false;

CREATE TABLE bridge_ai."SupplierCapability" (
  id text PRIMARY KEY,
  "supplierCompanyId" text NOT NULL REFERENCES bridge_ai.supplier_companies(id) ON DELETE CASCADE,
  "productCategoryId" text NOT NULL REFERENCES bridge_ai."ProductCategory"(id) ON DELETE CASCADE,
  "manufacturerNames" text[] NOT NULL DEFAULT '{}',
  "systemNames" text[] NOT NULL DEFAULT '{}',
  "colourNames" text[] NOT NULL DEFAULT '{}',
  "finishNames" text[] NOT NULL DEFAULT '{}',
  "minimumOrderValue" numeric(12,2),
  "minimumOrderQuantity" integer,
  "standardLeadTimeDays" integer NOT NULL,
  "urgentLeadTimeDays" integer,
  "collectionAvailable" boolean NOT NULL DEFAULT false,
  "deliveryDays" integer[] NOT NULL DEFAULT '{}',
  "capacityStatus" bridge_ai."SupplierCapacityStatus" NOT NULL DEFAULT 'AVAILABLE',
  "shortageNote" text,
  "shortageUntil" timestamptz(3),
  active boolean NOT NULL DEFAULT true,
  "lastConfirmedAt" timestamptz(3) NOT NULL DEFAULT now(),
  "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT supplier_capability_company_category_unique UNIQUE ("supplierCompanyId", "productCategoryId"),
  CONSTRAINT supplier_capability_lead_times_valid CHECK (
    "standardLeadTimeDays" BETWEEN 1 AND 730
    AND ("urgentLeadTimeDays" IS NULL OR "urgentLeadTimeDays" BETWEEN 1 AND "standardLeadTimeDays")
  ),
  CONSTRAINT supplier_capability_minimums_valid CHECK (
    ("minimumOrderValue" IS NULL OR "minimumOrderValue" >= 0)
    AND ("minimumOrderQuantity" IS NULL OR "minimumOrderQuantity" >= 1)
  ),
  CONSTRAINT supplier_capability_delivery_days_valid CHECK (
    "deliveryDays" <@ ARRAY[1,2,3,4,5,6,7]
  )
);

CREATE INDEX "SupplierCapability_productCategoryId_active_capacityStatus_idx"
  ON bridge_ai."SupplierCapability" ("productCategoryId", active, "capacityStatus");
CREATE INDEX "SupplierCapability_supplierCompanyId_lastConfirmedAt_idx"
  ON bridge_ai."SupplierCapability" ("supplierCompanyId", "lastConfirmedAt");

CREATE TABLE bridge_ai."SupplierMatchDecision" (
  id text PRIMARY KEY,
  "quoteRequestId" text NOT NULL REFERENCES bridge_ai."QuoteRequest"(id) ON DELETE CASCADE,
  "supplierCompanyId" text NOT NULL REFERENCES bridge_ai.supplier_companies(id) ON DELETE CASCADE,
  outcome bridge_ai."SupplierMatchOutcome" NOT NULL,
  score integer NOT NULL DEFAULT 0,
  selected boolean NOT NULL DEFAULT false,
  reasons jsonb NOT NULL,
  "capabilitySnapshot" jsonb,
  "decidedAt" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT supplier_match_decision_unique UNIQUE ("quoteRequestId", "supplierCompanyId"),
  CONSTRAINT supplier_match_score_valid CHECK (score BETWEEN 0 AND 100)
);

CREATE INDEX "SupplierMatchDecision_quoteRequestId_outcome_score_idx"
  ON bridge_ai."SupplierMatchDecision" ("quoteRequestId", outcome, score DESC);
CREATE INDEX "SupplierMatchDecision_supplierCompanyId_decidedAt_idx"
  ON bridge_ai."SupplierMatchDecision" ("supplierCompanyId", "decidedAt" DESC);

ALTER TABLE bridge_ai."SupplierCapability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."SupplierCapability" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."SupplierMatchDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."SupplierMatchDecision" FORCE ROW LEVEL SECURITY;

-- Legacy prototype buckets still contain files but are no longer used by the
-- portal. Keep the objects recoverable while closing anonymous public reads.
UPDATE storage.buckets
SET public = false
WHERE id IN ('drawings', 'spec-drawings')
  AND public = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON bridge_ai."SupplierCapability" TO authenticated, bridge_ai_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bridge_ai."SupplierMatchDecision" TO authenticated, bridge_ai_app;
REVOKE ALL ON bridge_ai."SupplierCapability", bridge_ai."SupplierMatchDecision" FROM PUBLIC, anon, service_role;

CREATE POLICY capability_member_read
  ON bridge_ai."SupplierCapability" FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.has_company_membership("supplierCompanyId"))
    OR (SELECT bridge_private.is_platform_admin())
    OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
  );
CREATE POLICY capability_manager_write
  ON bridge_ai."SupplierCapability" FOR ALL TO authenticated
  USING (
    (SELECT bridge_private.has_company_membership("supplierCompanyId", ARRAY['OWNER','MANAGER']::bridge_ai."SupplierTeamRole"[]))
    OR (SELECT bridge_private.is_platform_admin())
  )
  WITH CHECK (
    (SELECT bridge_private.has_company_membership("supplierCompanyId", ARRAY['OWNER','MANAGER']::bridge_ai."SupplierTeamRole"[]))
    OR (SELECT bridge_private.is_platform_admin())
  );

CREATE POLICY match_decision_read
  ON bridge_ai."SupplierMatchDecision" FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.has_company_membership("supplierCompanyId"))
    OR (SELECT bridge_private.is_platform_admin())
    OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
  );
CREATE POLICY match_decision_worker_insert
  ON bridge_ai."SupplierMatchDecision" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY match_decision_worker_update
  ON bridge_ai."SupplierMatchDecision" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));

-- Existing category selections become conservative capability records. Suppliers
-- must confirm systems, colours, lead times and capacity before those details can
-- satisfy a mandatory buyer requirement.
INSERT INTO bridge_ai."SupplierCapability" (
  id, "supplierCompanyId", "productCategoryId", "standardLeadTimeDays",
  "capacityStatus", active, "lastConfirmedAt", "createdAt", "updatedAt"
)
SELECT 'cap_' || md5(selection."supplierCompanyId" || ':' || selection."productCategoryId"),
       selection."supplierCompanyId", selection."productCategoryId", 14,
       'PAUSED', false, now(), now(), now()
FROM bridge_ai."SupplierProductCategory" selection
ON CONFLICT ("supplierCompanyId", "productCategoryId") DO NOTHING;

-- Suppliers only see opportunities selected for their own company. This closes
-- the former network-wide browsing path while retaining the minimal projection.
DROP POLICY IF EXISTS supplier_opportunity_read ON bridge_ai."SupplierOpportunity";
DROP POLICY IF EXISTS supplier_opportunity_approved_read ON bridge_ai."SupplierOpportunity";
DROP POLICY IF EXISTS supplier_opportunity_admin_read ON bridge_ai."SupplierOpportunity";
CREATE POLICY supplier_opportunity_scoped_read
  ON bridge_ai."SupplierOpportunity" FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_platform_admin())
    OR EXISTS (
      SELECT 1 FROM bridge_ai."SupplierAssignment" assignment
      WHERE assignment."quoteRequestId" = bridge_ai."SupplierOpportunity"."quoteRequestId"
        AND (SELECT bridge_private.has_company_membership(assignment."supplierCompanyId"))
    )
  );

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_supplier_capability_network_v1',
  'SYSTEM.CAPABILITY_NETWORK_ENABLED',
  'SupplierCapability',
  'capability_network_v1',
  'Structured supplier capability and capacity matching enabled',
  jsonb_build_object(
    'defaultSelectionLimit', 3,
    'staleAfterDays', 14,
    'legacyBucketsMadePrivate', ARRAY['drawings', 'spec-drawings']
  ),
  now()
) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE bridge_ai."SupplierCapability" IS
  'Supplier-confirmed category capability, systems, finishes, commercial limits, lead times and current capacity.';
COMMENT ON TABLE bridge_ai."SupplierMatchDecision" IS
  'Immutable-style matching evidence explaining qualification, rejection, score and selection for each considered supplier.';
