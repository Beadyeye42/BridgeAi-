ALTER TABLE bridge_ai."QuoteRequest"
  ADD COLUMN IF NOT EXISTS "selectedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "confirmedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "completedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "cancelledAfterSelectionAt" timestamptz;

CREATE INDEX IF NOT EXISTS "QuoteRequest_status_selectedAt_idx"
  ON bridge_ai."QuoteRequest" (status, "selectedAt");

-- Preserve historical selections without pretending that they were confirmed
-- jobs. The former closed timestamp is the best available selection evidence.
UPDATE bridge_ai."QuoteRequest"
SET status = 'SELECTED',
    "selectedAt" = COALESCE("closedAt", "updatedAt", now()),
    "closedAt" = NULL,
    "updatedAt" = now()
WHERE status = 'WON';

CREATE OR REPLACE FUNCTION bridge_private.enforce_request_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE accepted_count integer;
BEGIN
  -- Keep the legacy status safe during a rolling application deployment. Any
  -- old server instance that still writes WON is treated as a selection, not
  -- a confirmed job, and can transition cleanly once the new code is live.
  IF NEW.status = 'WON' AND NEW."selectedAt" IS NULL THEN
    NEW."selectedAt" = COALESCE(NEW."closedAt", NEW."updatedAt", now());
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('COMPLETED', 'CANCELLED_AFTER_SELECTION') THEN
      RAISE EXCEPTION 'final job lifecycle state cannot be changed' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'CONFIRMED' AND OLD.status NOT IN ('SELECTED', 'WON') THEN
      RAISE EXCEPTION 'job can only be confirmed after customer selection' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'COMPLETED' AND OLD.status <> 'CONFIRMED' THEN
      RAISE EXCEPTION 'job can only be completed after confirmation' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'CANCELLED_AFTER_SELECTION' AND OLD.status NOT IN ('SELECTED', 'WON', 'CONFIRMED') THEN
      RAISE EXCEPTION 'post-selection cancellation requires a selected or confirmed job' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status IN ('SELECTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED_AFTER_SELECTION', 'WON', 'LOST') THEN
    SELECT count(*) INTO accepted_count
    FROM bridge_ai."SupplierQuotation"
    WHERE "quoteRequestId" = NEW.id AND status = 'ACCEPTED';
    IF NEW.status IN ('SELECTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED_AFTER_SELECTION', 'WON') AND accepted_count <> 1 THEN
      RAISE EXCEPTION 'selected job lifecycle requires exactly one accepted quotation' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'LOST' AND accepted_count <> 0 THEN
      RAISE EXCEPTION 'lost request cannot have an accepted quotation' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status IN ('SELECTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED_AFTER_SELECTION') AND NEW."selectedAt" IS NULL THEN
    RAISE EXCEPTION 'selected job lifecycle requires selectedAt' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('CONFIRMED', 'COMPLETED') AND NEW."confirmedAt" IS NULL THEN
    RAISE EXCEPTION 'confirmed job lifecycle requires confirmedAt' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'COMPLETED' AND NEW."completedAt" IS NULL THEN
    RAISE EXCEPTION 'completed job lifecycle requires completedAt' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'CANCELLED_AFTER_SELECTION' AND NEW."cancelledAfterSelectionAt" IS NULL THEN
    RAISE EXCEPTION 'cancelled selected job requires cancellation timestamp' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_request_outcome() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_request_outcome ON bridge_ai."QuoteRequest";
CREATE TRIGGER enforce_request_outcome
  BEFORE INSERT OR UPDATE ON bridge_ai."QuoteRequest"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_request_outcome();

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_quote_request_lifecycle_v1',
  'SYSTEM.JOB_LIFECYCLE_ENABLED',
  'QuoteRequest',
  NULL,
  'Quote selection separated from confirmed and completed jobs',
  jsonb_build_object(
    'lifecycle', jsonb_build_array('SELECTED', 'CONFIRMED', 'COMPLETED'),
    'negativeOutcome', 'CANCELLED_AFTER_SELECTION',
    'legacyStatusRetained', 'WON'
  ),
  now()
)
ON CONFLICT (id) DO NOTHING;
