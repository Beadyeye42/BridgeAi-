-- Supplier approval is based on company identity and contact details.
-- Accreditation and insurance documents remain available as optional records,
-- but do not gate approval, matching or opportunity claims.
ALTER TABLE bridge_ai.supplier_companies
  ADD COLUMN IF NOT EXISTS "directorName" text;

ALTER TABLE bridge_ai.supplier_companies
  DROP CONSTRAINT IF EXISTS supplier_companies_director_name_valid;
ALTER TABLE bridge_ai.supplier_companies
  ADD CONSTRAINT supplier_companies_director_name_valid
  CHECK (
    "directorName" IS NULL
    OR length(btrim("directorName")) BETWEEN 2 AND 160
  );

CREATE OR REPLACE FUNCTION bridge_private.enforce_supplier_review_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT (SELECT bridge_private.is_platform_admin())
     AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
       OR NEW."approvedById" IS DISTINCT FROM OLD."approvedById"
       OR NEW."suspendedAt" IS DISTINCT FROM OLD."suspendedAt"
       OR NEW."suspensionNote" IS DISTINCT FROM OLD."suspensionNote"
     ) THEN
    RAISE EXCEPTION 'supplier review state can only be changed by a platform administrator'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'APPROVED' AND OLD.status IS DISTINCT FROM 'APPROVED' THEN
    IF length(btrim(NEW."legalName")) < 2
       OR length(btrim(COALESCE(NEW."companyNumber", ''))) < 2
       OR length(btrim(COALESCE(NEW."directorName", ''))) < 2
       OR length(btrim(NEW."contactEmail")) < 3
       OR length(btrim(NEW."contactPhone")) < 7
       OR length(btrim(COALESCE(NEW."addressLine1", ''))) < 2
       OR length(btrim(COALESCE(NEW.city, ''))) < 2
       OR length(btrim(COALESCE(NEW.postcode, ''))) < 3
       OR NEW."approvedAt" IS NULL
       OR NEW."approvedById" IS NULL THEN
      RAISE EXCEPTION 'supplier approval requirements are incomplete'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_supplier_review_state()
  FROM PUBLIC, anon, authenticated;

-- Keep the original defence-in-depth claim checks, but remove the former
-- accreditation requirement. Product, coverage, membership, subscription,
-- deadline and five-supplier limits are still rechecked transactionally.
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
