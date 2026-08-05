-- Approved suppliers may browse a deliberately minimal opportunity projection.
-- Private customer, conversation, item and attachment data remain behind the
-- existing assignment policies.
CREATE TABLE bridge_ai."SupplierOpportunity" (
  "quoteRequestId" text PRIMARY KEY
    REFERENCES bridge_ai."QuoteRequest"(id) ON DELETE CASCADE,
  reference text NOT NULL UNIQUE,
  title text NOT NULL,
  "categoryId" text NOT NULL
    REFERENCES bridge_ai."ProductCategory"(id) ON DELETE RESTRICT,
  "deliveryArea" varchar(12) NOT NULL,
  "itemCount" integer NOT NULL DEFAULT 0,
  "attachmentCount" integer NOT NULL DEFAULT 0,
  "distributionLimit" integer NOT NULL,
  "claimedSlots" integer NOT NULL DEFAULT 0,
  status bridge_ai."QuoteRequestStatus" NOT NULL,
  "publishedAt" timestamptz NOT NULL,
  "responseDueAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_opportunity_counts_valid CHECK (
    "itemCount" >= 0
    AND "attachmentCount" >= 0
    AND "distributionLimit" BETWEEN 1 AND 5
    AND "claimedSlots" BETWEEN 0 AND "distributionLimit"
  )
);

CREATE INDEX "SupplierOpportunity_status_responseDueAt_idx"
  ON bridge_ai."SupplierOpportunity" (status, "responseDueAt" DESC);
CREATE INDEX "SupplierOpportunity_categoryId_responseDueAt_idx"
  ON bridge_ai."SupplierOpportunity" ("categoryId", "responseDueAt" DESC);

ALTER TABLE bridge_ai."SupplierOpportunity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."SupplierOpportunity" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON bridge_ai."SupplierOpportunity" FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON bridge_ai."SupplierOpportunity" TO authenticated;

CREATE OR REPLACE FUNCTION bridge_private.can_browse_supplier_opportunities()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM bridge_ai.company_memberships membership
      JOIN bridge_ai.portal_profiles profile ON profile.id = membership."userId"
      JOIN bridge_ai.supplier_companies company ON company.id = membership."supplierCompanyId"
      WHERE membership."userId" = (SELECT auth.uid())
        AND membership.status = 'ACTIVE'
        AND profile.status = 'ACTIVE'
        AND company.status = 'APPROVED'
    )
$$;

REVOKE ALL ON FUNCTION bridge_private.can_browse_supplier_opportunities()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.can_browse_supplier_opportunities()
  TO authenticated;

CREATE POLICY supplier_opportunity_approved_read
  ON bridge_ai."SupplierOpportunity" FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.can_browse_supplier_opportunities())
    AND status IN ('OPEN', 'MATCHING', 'QUOTED')
    AND "responseDueAt" > now()
  );
CREATE POLICY supplier_opportunity_admin_read
  ON bridge_ai."SupplierOpportunity" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_platform_admin()));

-- These trigger-only writers keep the public projection accurate without
-- granting portal identities write access to it.
CREATE OR REPLACE FUNCTION bridge_private.sync_supplier_opportunity(target_request_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO bridge_ai."SupplierOpportunity" (
    "quoteRequestId", reference, title, "categoryId", "deliveryArea",
    "itemCount", "attachmentCount", "distributionLimit", "claimedSlots",
    status, "publishedAt", "responseDueAt", "createdAt", "updatedAt"
  )
  SELECT request.id,
         request.reference,
         request.title,
         request."categoryId",
         split_part(upper(trim(request."deliveryPostcode")), ' ', 1),
         (SELECT count(*) FROM bridge_ai."QuoteRequestItem" item WHERE item."quoteRequestId" = request.id),
         (SELECT count(*) FROM bridge_ai."Attachment" attachment WHERE attachment."quoteRequestId" = request.id),
         request."distributionLimit",
         (SELECT count(*) FROM bridge_ai."SupplierAssignment" assignment
          WHERE assignment."quoteRequestId" = request.id AND assignment.status <> 'WITHDRAWN'),
         request.status,
         COALESCE(request."publishedAt", request."createdAt"),
         request."responseDueAt",
         request."createdAt",
         now()
  FROM bridge_ai."QuoteRequest" request
  WHERE request.id = target_request_id
    AND request.status IN ('OPEN', 'MATCHING', 'QUOTED')
  ON CONFLICT ("quoteRequestId") DO UPDATE SET
    reference = EXCLUDED.reference,
    title = EXCLUDED.title,
    "categoryId" = EXCLUDED."categoryId",
    "deliveryArea" = EXCLUDED."deliveryArea",
    "itemCount" = EXCLUDED."itemCount",
    "attachmentCount" = EXCLUDED."attachmentCount",
    "distributionLimit" = EXCLUDED."distributionLimit",
    "claimedSlots" = EXCLUDED."claimedSlots",
    status = EXCLUDED.status,
    "publishedAt" = EXCLUDED."publishedAt",
    "responseDueAt" = EXCLUDED."responseDueAt",
    "updatedAt" = now();

  DELETE FROM bridge_ai."SupplierOpportunity"
  WHERE "quoteRequestId" = target_request_id
    AND NOT EXISTS (
      SELECT 1 FROM bridge_ai."QuoteRequest" request
      WHERE request.id = target_request_id
        AND request.status IN ('OPEN', 'MATCHING', 'QUOTED')
    );
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.sync_supplier_opportunity(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION bridge_private.refresh_supplier_opportunity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."quoteRequestId" IS NOT NULL THEN
    PERFORM bridge_private.sync_supplier_opportunity(OLD."quoteRequestId");
  END IF;
  IF TG_OP = 'INSERT'
     OR (TG_OP = 'UPDATE' AND NEW."quoteRequestId" IS DISTINCT FROM OLD."quoteRequestId") THEN
    PERFORM bridge_private.sync_supplier_opportunity(NEW."quoteRequestId");
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.refresh_supplier_opportunity()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION bridge_private.refresh_supplier_opportunity_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM bridge_private.sync_supplier_opportunity(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.refresh_supplier_opportunity_request()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER refresh_supplier_opportunity_request
  AFTER INSERT OR UPDATE
  ON bridge_ai."QuoteRequest"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.refresh_supplier_opportunity_request();

CREATE TRIGGER refresh_supplier_opportunity_items
  AFTER INSERT OR UPDATE OR DELETE
  ON bridge_ai."QuoteRequestItem"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.refresh_supplier_opportunity();

CREATE TRIGGER refresh_supplier_opportunity_attachments
  AFTER INSERT OR UPDATE OR DELETE
  ON bridge_ai."Attachment"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.refresh_supplier_opportunity();

CREATE TRIGGER refresh_supplier_opportunity_assignments
  AFTER INSERT OR UPDATE OR DELETE
  ON bridge_ai."SupplierAssignment"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.refresh_supplier_opportunity();

-- Only the server-side identity-aware application role can request a slot.
-- The function still re-checks the authenticated user, company, subscription,
-- category, accreditation, coverage, deadline and five-supplier cap itself.
CREATE OR REPLACE FUNCTION bridge_private.claim_supplier_opportunity(
  target_reference text,
  target_company_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := (SELECT auth.uid());
  request_row bridge_ai."QuoteRequest"%ROWTYPE;
  assignment_id text := 'claim_' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF actor_id IS NULL OR NOT bridge_private.has_company_membership(target_company_id) THEN
    RAISE EXCEPTION 'CLAIM_NOT_AUTHORISED' USING ERRCODE = '42501';
  END IF;

  SELECT request.* INTO request_row
  FROM bridge_ai."QuoteRequest" request
  JOIN bridge_ai."SupplierOpportunity" opportunity ON opportunity."quoteRequestId" = request.id
  WHERE opportunity.reference = target_reference
  FOR UPDATE OF request;

  IF request_row.id IS NULL THEN
    RAISE EXCEPTION 'OPPORTUNITY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF request_row.status NOT IN ('OPEN', 'MATCHING', 'QUOTED') OR request_row."responseDueAt" <= now() THEN
    RAISE EXCEPTION 'OPPORTUNITY_CLOSED' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bridge_ai."SupplierAssignment" assignment
    WHERE assignment."quoteRequestId" = request_row.id
      AND assignment."supplierCompanyId" = target_company_id
  ) THEN
    SELECT assignment.id INTO assignment_id
    FROM bridge_ai."SupplierAssignment" assignment
    WHERE assignment."quoteRequestId" = request_row.id
      AND assignment."supplierCompanyId" = target_company_id;
    RETURN assignment_id;
  END IF;
  IF (SELECT count(*) FROM bridge_ai."SupplierAssignment" assignment
      WHERE assignment."quoteRequestId" = request_row.id AND assignment.status <> 'WITHDRAWN') >= LEAST(request_row."distributionLimit", 5) THEN
    RAISE EXCEPTION 'OPPORTUNITY_FULL' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM bridge_ai.supplier_companies company
    JOIN bridge_ai."Subscription" subscription ON subscription."supplierCompanyId" = company.id
    WHERE company.id = target_company_id
      AND company.status = 'APPROVED'
      AND subscription.status = 'ACTIVE'
      AND (subscription."currentPeriodEnd" IS NULL OR subscription."currentPeriodEnd" > now())
  ) THEN
    RAISE EXCEPTION 'ACTIVE_SUBSCRIPTION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM bridge_ai."SupplierProductCategory" category
    WHERE category."supplierCompanyId" = target_company_id
      AND category."productCategoryId" = request_row."categoryId"
  ) THEN
    RAISE EXCEPTION 'CATEGORY_NOT_MATCHED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM bridge_ai.supplier_accreditations accreditation
    JOIN bridge_ai."Attachment" attachment ON attachment.id = accreditation."attachmentId"
    WHERE accreditation."supplierCompanyId" = target_company_id
      AND accreditation.status = 'APPROVED'
      AND attachment."scanStatus" = 'CLEAN'
      AND (accreditation."expiresAt" IS NULL OR accreditation."expiresAt" > now())
  ) THEN
    RAISE EXCEPTION 'ACCREDITATION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM bridge_ai."CoverageArea" coverage
    WHERE coverage."supplierCompanyId" = target_company_id
      AND coverage.active
      AND (
        coverage.type = 'NATIONWIDE'
        OR (
          coverage.type = 'POSTCODE'
          AND upper(regexp_replace(request_row."deliveryPostcode", '\\s', '', 'g'))
              LIKE upper(regexp_replace(coverage."postcodePrefix", '\\s', '', 'g')) || '%'
        )
        OR (
          coverage.type = 'DISTANCE'
          AND request_row."deliveryLatitude" IS NOT NULL
          AND request_row."deliveryLongitude" IS NOT NULL
          AND coverage.latitude IS NOT NULL
          AND coverage.longitude IS NOT NULL
          AND coverage."radiusMiles" IS NOT NULL
          AND 3958.7613 * acos(least(1, greatest(-1,
            sin(radians(coverage.latitude::double precision)) * sin(radians(request_row."deliveryLatitude"::double precision))
            + cos(radians(coverage.latitude::double precision)) * cos(radians(request_row."deliveryLatitude"::double precision))
            * cos(radians(request_row."deliveryLongitude"::double precision - coverage.longitude::double precision))
          ))) <= coverage."radiusMiles"
        )
      )
  ) THEN
    RAISE EXCEPTION 'COVERAGE_NOT_MATCHED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO bridge_ai."SupplierAssignment" (
    id, "quoteRequestId", "supplierCompanyId", status,
    "assignedAt", "expiresAt", "assignedById"
  ) VALUES (
    assignment_id, request_row.id, target_company_id, 'ACCEPTED',
    now(), request_row."responseDueAt", actor_id
  );
  UPDATE bridge_ai."QuoteRequest"
  SET status = 'MATCHING', "updatedAt" = now()
  WHERE id = request_row.id AND status = 'OPEN';
  INSERT INTO bridge_ai."AuditLog" (
    id, "actorUserId", "supplierCompanyId", action, "entityType",
    "entityId", summary, metadata, "createdAt"
  ) VALUES (
    'audit_' || replace(gen_random_uuid()::text, '-', ''),
    actor_id, target_company_id, 'OPPORTUNITY.CLAIMED',
    'SupplierAssignment', assignment_id,
    'Subscribed supplier claimed an opportunity slot',
    jsonb_build_object('quoteRequestId', request_row.id, 'reference', request_row.reference),
    now()
  );
  RETURN assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.claim_supplier_opportunity(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridge_ai_app') THEN
    GRANT EXECUTE ON FUNCTION bridge_private.claim_supplier_opportunity(text, text)
      TO bridge_ai_app;
  END IF;
END
$$;

-- Backfill currently open requests into the safe projection.
SELECT bridge_private.sync_supplier_opportunity(request.id)
FROM bridge_ai."QuoteRequest" request
WHERE request.status IN ('OPEN', 'MATCHING', 'QUOTED');
