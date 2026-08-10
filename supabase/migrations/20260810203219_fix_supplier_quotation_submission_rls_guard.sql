-- A supplier can read an assigned request through RLS, but a row trigger runs
-- after the INSERT policy and must independently enforce the cross-row request
-- and assignment invariants. The previous invoker function could not see the
-- request row through the supplier's RLS context and incorrectly raised
-- QUOTE_REQUEST_NOT_FOUND for every valid submission.

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

-- Trigger functions do not need to be remotely executable. Keeping this
-- private function owner-only prevents it becoming an RPC/RLS bypass.
REVOKE ALL ON FUNCTION bridge_private.enforce_open_request_for_quotation_submission()
  FROM PUBLIC, anon, authenticated, service_role, bridge_ai_app;

DROP POLICY IF EXISTS production_monitoring_select_storage_events
  ON bridge_ai."SystemEvent";
DROP POLICY IF EXISTS production_monitoring_select_operational_events
  ON bridge_ai."SystemEvent";
CREATE POLICY production_monitoring_select_operational_events
  ON bridge_ai."SystemEvent"
  FOR SELECT
  TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('production_monitoring'))
    AND status <> 'RESOLVED'
    AND severity IN ('ERROR', 'CRITICAL')
    AND (
      source IN ('storage', 'attachment', 'quotation')
      OR code LIKE '%UPLOAD_FAILED%'
      OR code LIKE '%ATTACHMENT%'
      OR code = 'QUOTATION_SUBMIT_FAILED'
    )
  );

DROP POLICY IF EXISTS production_monitoring_insert_quotation_events
  ON bridge_ai."SystemEvent";
CREATE POLICY production_monitoring_insert_quotation_events
  ON bridge_ai."SystemEvent"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('production_monitoring'))
    AND severity IN ('ERROR', 'CRITICAL')
    AND status = 'OPEN'
    AND source = 'quotation'
    AND code = 'QUOTATION_SUBMIT_FAILED'
  );

DROP POLICY IF EXISTS production_monitoring_insert_alerts
  ON bridge_ai."ProductionAlert";
CREATE POLICY production_monitoring_insert_alerts
  ON bridge_ai."ProductionAlert"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('production_monitoring'))
    AND source IN ('WHATSAPP', 'STRIPE', 'ATTACHMENT', 'QUOTATION')
    AND severity IN ('WARNING', 'ERROR', 'CRITICAL')
    AND (
      fingerprint LIKE 'whatsapp-job:%'
      OR fingerprint LIKE 'stripe-webhook:%'
      OR fingerprint LIKE 'attachment:%'
      OR fingerprint LIKE 'system-event:%'
    )
    AND "actionUrl" LIKE '%/admin/system'
  );

INSERT INTO bridge_ai."AuditLog" (
  id,
  action,
  "entityType",
  summary,
  metadata,
  "createdAt"
)
VALUES (
  'system_fix_supplier_quotation_submission_rls_20260810202818',
  'SYSTEM.SUPPLIER_QUOTATION_GUARD_REPAIRED',
  'SecurityConfiguration',
  'Repaired the RLS-safe supplier quotation guard and production failure monitoring',
  jsonb_build_object(
    'guard', 'bridge_private.enforce_open_request_for_quotation_submission',
    'remote_execute', false,
    'monitoring_source', 'quotation'
  ),
  now()
);
