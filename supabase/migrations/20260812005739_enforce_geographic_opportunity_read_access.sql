-- Enforce the currently paid geographic tier at every live opportunity read
-- and write boundary. Submitted quotation history remains available for audit,
-- but cancelling or downgrading immediately removes unquoted live leads that
-- are no longer inside the supplier's entitlement.

CREATE OR REPLACE FUNCTION bridge_private.supplier_assignment_within_active_geography(
  target_assignment_id text,
  target_company_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH assignment_location AS (
    SELECT
      assignment.id,
      assignment."supplierCompanyId",
      request."deliveryLatitude" AS request_latitude,
      request."deliveryLongitude" AS request_longitude,
      request."fulfilmentMode"
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
          CASE WHEN assignment_location."fulfilmentMode" IN ('SERVICE', 'INSTALLATION')
            THEN company."maximumServiceRadiusOverride"
            ELSE company."maximumDeliveryRadiusOverride"
          END
        WHEN assignment_location."fulfilmentMode" IN ('SERVICE', 'INSTALLATION')
             AND company."maximumServiceRadiusOverride" IS NOT NULL
          THEN least(company."maximumServiceRadiusOverride", limits.maximum_radius)
        WHEN assignment_location."fulfilmentMode" NOT IN ('SERVICE', 'INSTALLATION')
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
$$;

CREATE OR REPLACE FUNCTION bridge_private.supplier_assignment_currently_entitled(
  target_assignment_id text,
  target_company_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM bridge_ai."SupplierAssignment" assignment
    WHERE assignment.id = target_assignment_id
      AND assignment."supplierCompanyId" = target_company_id
      AND (
        EXISTS (
          SELECT 1
          FROM bridge_ai."SupplierQuotation" quotation
          WHERE quotation."assignmentId" = assignment.id
        )
        OR bridge_private.supplier_assignment_within_active_geography(
          assignment.id,
          assignment."supplierCompanyId"
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION bridge_private.supplier_assignment_within_active_geography(text, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION bridge_private.supplier_assignment_currently_entitled(text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.supplier_assignment_within_active_geography(text, text)
  TO authenticated, bridge_ai_app;
GRANT EXECUTE ON FUNCTION bridge_private.supplier_assignment_currently_entitled(text, text)
  TO authenticated, bridge_ai_app;

CREATE OR REPLACE FUNCTION bridge_private.can_access_request(target_request_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT bridge_private.is_platform_admin()
      OR EXISTS (
        SELECT 1
        FROM bridge_ai."SupplierAssignment" assignment
        WHERE assignment."quoteRequestId" = target_request_id
          AND bridge_private.has_company_membership(assignment."supplierCompanyId")
          AND bridge_private.supplier_assignment_currently_entitled(
            assignment.id,
            assignment."supplierCompanyId"
          )
      );
$$;

REVOKE ALL ON FUNCTION bridge_private.can_access_request(text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.can_access_request(text)
  TO authenticated, bridge_ai_app;

DROP POLICY IF EXISTS assignment_company_read ON bridge_ai."SupplierAssignment";
CREATE POLICY assignment_company_read
  ON bridge_ai."SupplierAssignment"
  FOR SELECT
  TO authenticated
  USING (
    (SELECT bridge_private.has_company_membership("supplierCompanyId"))
    AND (SELECT bridge_private.supplier_assignment_currently_entitled(
      id,
      "supplierCompanyId"
    ))
  );

DROP POLICY IF EXISTS assignment_company_update ON bridge_ai."SupplierAssignment";
CREATE POLICY assignment_company_update
  ON bridge_ai."SupplierAssignment"
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT bridge_private.has_company_membership(
      "supplierCompanyId",
      ARRAY['OWNER','MANAGER','MEMBER']::bridge_ai."SupplierTeamRole"[]
    ))
    AND (SELECT bridge_private.supplier_assignment_within_active_geography(
      id,
      "supplierCompanyId"
    ))
  )
  WITH CHECK (
    (SELECT bridge_private.has_company_membership(
      "supplierCompanyId",
      ARRAY['OWNER','MANAGER','MEMBER']::bridge_ai."SupplierTeamRole"[]
    ))
    AND (SELECT bridge_private.supplier_assignment_within_active_geography(
      id,
      "supplierCompanyId"
    ))
  );

DROP POLICY IF EXISTS supplier_opportunity_scoped_read ON bridge_ai."SupplierOpportunity";
CREATE POLICY supplier_opportunity_scoped_read
  ON bridge_ai."SupplierOpportunity"
  FOR SELECT
  TO authenticated
  USING (
    (SELECT bridge_private.is_platform_admin())
    OR EXISTS (
      SELECT 1
      FROM bridge_ai."SupplierAssignment" assignment
      WHERE assignment."quoteRequestId" = bridge_ai."SupplierOpportunity"."quoteRequestId"
        AND assignment.status IN ('PENDING', 'VIEWED', 'ACCEPTED')
        AND (SELECT bridge_private.has_company_membership(assignment."supplierCompanyId"))
        AND (SELECT bridge_private.supplier_assignment_within_active_geography(
          assignment.id,
          assignment."supplierCompanyId"
        ))
    )
  );

DROP POLICY IF EXISTS quotation_company_insert ON bridge_ai."SupplierQuotation";
CREATE POLICY quotation_company_insert
  ON bridge_ai."SupplierQuotation"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT bridge_private.has_company_membership("supplierCompanyId"))
    AND (SELECT bridge_private.supplier_assignment_within_active_geography(
      "assignmentId",
      "supplierCompanyId"
    ))
  );

DROP POLICY IF EXISTS quotation_company_update ON bridge_ai."SupplierQuotation";
CREATE POLICY quotation_company_update
  ON bridge_ai."SupplierQuotation"
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT bridge_private.has_company_membership("supplierCompanyId"))
    AND (SELECT bridge_private.supplier_assignment_within_active_geography(
      "assignmentId",
      "supplierCompanyId"
    ))
  )
  WITH CHECK (
    (SELECT bridge_private.has_company_membership("supplierCompanyId"))
    AND (SELECT bridge_private.supplier_assignment_within_active_geography(
      "assignmentId",
      "supplierCompanyId"
    ))
  );

CREATE OR REPLACE FUNCTION bridge_private.enforce_open_request_for_quotation_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_status bridge_ai."QuoteRequestStatus";
  response_due_at timestamptz;
  assignment_status bridge_ai."AssignmentStatus";
  assignment_expires_at timestamptz;
BEGIN
  IF NEW.status <> 'SUBMITTED' THEN
    RETURN NEW;
  END IF;

  IF NOT bridge_private.supplier_assignment_within_active_geography(
    NEW."assignmentId",
    NEW."supplierCompanyId"
  ) THEN
    RAISE EXCEPTION 'MEMBERSHIP_AREA_REQUIRED' USING ERRCODE = '23514';
  END IF;

  SELECT
    request.status,
    request."responseDueAt",
    assignment.status,
    assignment."expiresAt"
  INTO
    request_status,
    response_due_at,
    assignment_status,
    assignment_expires_at
  FROM bridge_ai."QuoteRequest" request
  JOIN bridge_ai."SupplierAssignment" assignment
    ON assignment.id = NEW."assignmentId"
   AND assignment."quoteRequestId" = NEW."quoteRequestId"
   AND assignment."supplierCompanyId" = NEW."supplierCompanyId"
  WHERE request.id = NEW."quoteRequestId"
  FOR SHARE OF request, assignment;

  IF request_status IS NULL THEN
    RAISE EXCEPTION 'QUOTATION_ASSIGNMENT_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
  IF assignment_status NOT IN ('ACCEPTED', 'QUOTED')
     OR assignment_expires_at IS NULL
     OR assignment_expires_at <= now() THEN
    RAISE EXCEPTION 'ASSIGNMENT_CLOSED' USING ERRCODE = '23514';
  END IF;
  IF request_status NOT IN ('OPEN', 'MATCHING', 'QUOTED')
     OR response_due_at IS NULL
     OR response_due_at <= now() THEN
    RAISE EXCEPTION 'QUOTE_REQUEST_CLOSED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_open_request_for_quotation_submission()
  FROM PUBLIC, anon, authenticated, service_role, bridge_ai_app;

CREATE OR REPLACE FUNCTION bridge_private.enforce_approved_supplier_verified_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'APPROVED' AND (
    nullif(btrim(NEW.postcode), '') IS NULL
    OR NEW."geographicOriginLatitude" IS NULL
    OR NEW."geographicOriginLongitude" IS NULL
  ) THEN
    RAISE EXCEPTION 'VERIFIED_COMPANY_POSTCODE_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_approved_supplier_verified_location()
  FROM PUBLIC, anon, authenticated, service_role, bridge_ai_app;

DROP TRIGGER IF EXISTS enforce_approved_supplier_verified_location
  ON bridge_ai.supplier_companies;
CREATE TRIGGER enforce_approved_supplier_verified_location
  BEFORE INSERT OR UPDATE OF status, postcode, "geographicOriginLatitude", "geographicOriginLongitude"
  ON bridge_ai.supplier_companies
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_approved_supplier_verified_location();

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'system_geographic_read_access_20260812131500',
  'SYSTEM.GEOGRAPHIC_OPPORTUNITY_ACCESS_ENFORCED',
  'SecurityConfiguration',
  'supplier-geographic-opportunity-access',
  'Enforced verified supplier postcodes and current paid distance limits for live opportunity reads and writes',
  jsonb_build_object(
    'verifiedPostcodeRequiredForApproval', true,
    'downgradesAppliedToLiveReads', true,
    'quotationHistoryRetained', true,
    'attachmentReadsScoped', true
  ),
  now()
) ON CONFLICT (id) DO NOTHING;
