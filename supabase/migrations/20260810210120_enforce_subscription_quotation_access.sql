-- Supplier quotation access is a paid entitlement. Scheduled Stripe
-- cancellations remain ACTIVE until the paid-through currentPeriodEnd; once
-- that time passes (or Stripe reports a non-active status), live opportunities
-- and quotation writes must fail closed at the database boundary.

CREATE OR REPLACE FUNCTION bridge_private.has_active_supplier_subscription(
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
    FROM bridge_ai."Subscription" subscription
    WHERE subscription."supplierCompanyId" = target_company_id
      AND subscription.status = 'ACTIVE'
      AND (
        subscription."currentPeriodEnd" IS NULL
        OR subscription."currentPeriodEnd" > now()
      )
  );
$$;

REVOKE ALL ON FUNCTION bridge_private.has_active_supplier_subscription(text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.has_active_supplier_subscription(text)
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
          AND (
            bridge_private.has_active_supplier_subscription(assignment."supplierCompanyId")
            OR EXISTS (
              SELECT 1
              FROM bridge_ai."SupplierQuotation" quotation
              WHERE quotation."assignmentId" = assignment.id
            )
          )
      );
$$;

REVOKE ALL ON FUNCTION bridge_private.can_access_request(text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.can_access_request(text)
  TO authenticated, bridge_ai_app;

DROP POLICY IF EXISTS assignment_company_read
  ON bridge_ai."SupplierAssignment";
CREATE POLICY assignment_company_read
  ON bridge_ai."SupplierAssignment"
  FOR SELECT
  TO authenticated
  USING (
    (SELECT bridge_private.has_company_membership("supplierCompanyId"))
    AND (
      (SELECT bridge_private.has_active_supplier_subscription("supplierCompanyId"))
      OR EXISTS (
        SELECT 1
        FROM bridge_ai."SupplierQuotation" quotation
        WHERE quotation."assignmentId" = bridge_ai."SupplierAssignment".id
      )
    )
  );

DROP POLICY IF EXISTS assignment_company_update
  ON bridge_ai."SupplierAssignment";
CREATE POLICY assignment_company_update
  ON bridge_ai."SupplierAssignment"
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT bridge_private.has_company_membership(
      "supplierCompanyId",
      ARRAY['OWNER','MANAGER','MEMBER']::bridge_ai."SupplierTeamRole"[]
    ))
    AND (SELECT bridge_private.has_active_supplier_subscription("supplierCompanyId"))
  )
  WITH CHECK (
    (SELECT bridge_private.has_company_membership(
      "supplierCompanyId",
      ARRAY['OWNER','MANAGER','MEMBER']::bridge_ai."SupplierTeamRole"[]
    ))
    AND (SELECT bridge_private.has_active_supplier_subscription("supplierCompanyId"))
  );

DROP POLICY IF EXISTS supplier_opportunity_scoped_read
  ON bridge_ai."SupplierOpportunity";
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
        AND (SELECT bridge_private.has_active_supplier_subscription(assignment."supplierCompanyId"))
    )
  );

DROP POLICY IF EXISTS quotation_company_insert
  ON bridge_ai."SupplierQuotation";
CREATE POLICY quotation_company_insert
  ON bridge_ai."SupplierQuotation"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT bridge_private.has_company_membership("supplierCompanyId"))
    AND (SELECT bridge_private.has_active_supplier_subscription("supplierCompanyId"))
  );

DROP POLICY IF EXISTS quotation_company_update
  ON bridge_ai."SupplierQuotation";
CREATE POLICY quotation_company_update
  ON bridge_ai."SupplierQuotation"
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT bridge_private.has_company_membership("supplierCompanyId"))
    AND (SELECT bridge_private.has_active_supplier_subscription("supplierCompanyId"))
  )
  WITH CHECK (
    (SELECT bridge_private.has_company_membership("supplierCompanyId"))
    AND (SELECT bridge_private.has_active_supplier_subscription("supplierCompanyId"))
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

  IF NOT bridge_private.has_active_supplier_subscription(NEW."supplierCompanyId") THEN
    RAISE EXCEPTION 'ACTIVE_MEMBERSHIP_REQUIRED' USING ERRCODE = '23514';
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

CREATE OR REPLACE FUNCTION bridge_private.reconcile_supplier_subscription_access(
  target_company_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  withdrawn_count integer := 0;
  withdrawn_request_ids text[] := ARRAY[]::text[];
BEGIN
  IF bridge_private.has_active_supplier_subscription(target_company_id) THEN
    RETURN 0;
  END IF;

  WITH withdrawn AS (
    UPDATE bridge_ai."SupplierAssignment" assignment
    SET status = 'WITHDRAWN',
        "respondedAt" = now(),
        "declinedReason" = 'Membership ended; renew to receive and quote live opportunities.'
    FROM bridge_ai."QuoteRequest" request
    WHERE assignment."supplierCompanyId" = target_company_id
      AND request.id = assignment."quoteRequestId"
      AND assignment.status IN ('PENDING', 'VIEWED', 'ACCEPTED')
      AND request.status IN ('OPEN', 'MATCHING', 'QUOTED')
      AND NOT EXISTS (
        SELECT 1
        FROM bridge_ai."SupplierQuotation" quotation
        WHERE quotation."assignmentId" = assignment.id
      )
    RETURNING assignment."quoteRequestId"
  )
  SELECT count(*)::integer, coalesce(array_agg("quoteRequestId"), ARRAY[]::text[])
  INTO withdrawn_count, withdrawn_request_ids
  FROM withdrawn;

  UPDATE bridge_ai."SupplierMatchDecision" decision
  SET selected = false,
      outcome = 'REJECTED',
      reasons = coalesce(decision.reasons, '[]'::jsonb)
        || jsonb_build_array('Supplier membership ended before quotation submission')
  WHERE decision."supplierCompanyId" = target_company_id
    AND decision."quoteRequestId" = ANY(withdrawn_request_ids);

  IF withdrawn_count > 0 THEN
    INSERT INTO bridge_ai."AuditLog" (
      id, "supplierCompanyId", action, "entityType", "entityId", summary, metadata, "createdAt"
    ) VALUES (
      'membership_expiry_' || replace(gen_random_uuid()::text, '-', ''),
      target_company_id,
      'MEMBERSHIP.ACCESS_EXPIRED',
      'SupplierCompany',
      target_company_id,
      'Withdrew live quote opportunities after supplier membership access ended',
      jsonb_build_object('withdrawnAssignments', withdrawn_count),
      now()
    );
  END IF;

  RETURN withdrawn_count;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.reconcile_supplier_subscription_access(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.reconcile_supplier_subscription_access(text)
  TO bridge_ai_app;

CREATE OR REPLACE FUNCTION bridge_private.reconcile_subscription_access_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM bridge_private.reconcile_supplier_subscription_access(NEW."supplierCompanyId");
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.reconcile_subscription_access_trigger()
  FROM PUBLIC, anon, authenticated, service_role, bridge_ai_app;

DROP TRIGGER IF EXISTS reconcile_subscription_access_after_change
  ON bridge_ai."Subscription";
CREATE TRIGGER reconcile_subscription_access_after_change
  AFTER INSERT OR UPDATE OF status, "currentPeriodEnd"
  ON bridge_ai."Subscription"
  FOR EACH ROW
  EXECUTE FUNCTION bridge_private.reconcile_subscription_access_trigger();

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'system_subscription_quotation_access_20260810205306',
  'SYSTEM.SUBSCRIPTION_QUOTATION_ACCESS_ENFORCED',
  'SecurityConfiguration',
  'supplier-membership-access',
  'Enforced active paid-through membership for live opportunity access and quotation writes',
  jsonb_build_object(
    'scheduledCancellationRetainsPaidThroughAccess', true,
    'databaseQuotationGuard', true,
    'expiredOpportunityWithdrawal', true,
    'historicalQuotationReadAccess', true
  ),
  now()
) ON CONFLICT (id) DO NOTHING;
