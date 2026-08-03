-- Supplier response time is measured in Europe/London. The clock pauses from
-- Friday 15:00 until Monday 08:00, including across BST/GMT transitions.
CREATE OR REPLACE FUNCTION bridge_private.next_supplier_response_start(input_at timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  local_at timestamp := input_at AT TIME ZONE 'Europe/London';
  local_day integer := extract(isodow FROM local_at);
  resume_date date;
BEGIN
  IF local_day = 5 AND local_at::time >= time '15:00' THEN
    resume_date := local_at::date + 3;
  ELSIF local_day = 6 THEN
    resume_date := local_at::date + 2;
  ELSIF local_day = 7 THEN
    resume_date := local_at::date + 1;
  ELSE
    RETURN input_at;
  END IF;
  RETURN (resume_date + time '08:00') AT TIME ZONE 'Europe/London';
END;
$$;

CREATE OR REPLACE FUNCTION bridge_private.add_supplier_response_hours(input_at timestamptz, response_hours integer)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  cursor_at timestamptz;
  local_cursor timestamp;
  local_day integer;
  days_until_friday integer;
  cutoff_at timestamptz;
  available_seconds double precision;
  remaining_seconds double precision := response_hours * 3600.0;
BEGIN
  IF response_hours < 1 OR response_hours > 336 THEN
    RAISE EXCEPTION 'supplier response hours must be between 1 and 336' USING ERRCODE = '23514';
  END IF;
  cursor_at := bridge_private.next_supplier_response_start(input_at);
  WHILE remaining_seconds > 0 LOOP
    local_cursor := cursor_at AT TIME ZONE 'Europe/London';
    local_day := extract(isodow FROM local_cursor);
    days_until_friday := (5 - local_day + 7) % 7;
    cutoff_at := (
      local_cursor::date + days_until_friday + time '15:00'
    ) AT TIME ZONE 'Europe/London';
    IF cutoff_at <= cursor_at THEN
      cutoff_at := (
        local_cursor::date + days_until_friday + 7 + time '15:00'
      ) AT TIME ZONE 'Europe/London';
    END IF;
    available_seconds := extract(epoch FROM cutoff_at - cursor_at);
    IF remaining_seconds <= available_seconds THEN
      RETURN cursor_at + remaining_seconds * interval '1 second';
    END IF;
    remaining_seconds := remaining_seconds - available_seconds;
    cursor_at := bridge_private.next_supplier_response_start(cutoff_at);
  END LOOP;
  RETURN cursor_at;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.next_supplier_response_start(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bridge_private.add_supplier_response_hours(timestamptz, integer) FROM PUBLIC, anon, authenticated;

ALTER TABLE bridge_ai."QuoteRequest"
  DROP CONSTRAINT quote_distribution_limit_valid,
  ADD CONSTRAINT quote_distribution_limit_valid CHECK ("distributionLimit" BETWEEN 1 AND 5),
  ADD CONSTRAINT quote_response_due_outside_weekend_pause CHECK (
    extract(isodow FROM ("responseDueAt" AT TIME ZONE 'Europe/London')) NOT IN (6, 7)
    AND NOT (
      extract(isodow FROM ("responseDueAt" AT TIME ZONE 'Europe/London')) = 5
      AND ("responseDueAt" AT TIME ZONE 'Europe/London')::time > time '15:00'
    )
    AND NOT (
      extract(isodow FROM ("responseDueAt" AT TIME ZONE 'Europe/London')) = 1
      AND ("responseDueAt" AT TIME ZONE 'Europe/London')::time < time '08:00'
    )
  );

ALTER TABLE bridge_ai."SupplierAssignment"
  ADD CONSTRAINT assignment_deadline_after_assignment CHECK ("expiresAt" > "assignedAt");

CREATE OR REPLACE FUNCTION bridge_private.enforce_assignment_response_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE request_deadline timestamptz;
BEGIN
  SELECT "responseDueAt" INTO request_deadline
  FROM bridge_ai."QuoteRequest"
  WHERE id = NEW."quoteRequestId";
  IF request_deadline IS NULL OR NEW."expiresAt" <> request_deadline THEN
    RAISE EXCEPTION 'supplier assignment must use the shared request response deadline' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION bridge_private.enforce_request_assignment_deadlines()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bridge_ai."SupplierAssignment"
    WHERE "quoteRequestId" = NEW.id AND "expiresAt" <> NEW."responseDueAt"
  ) THEN
    RAISE EXCEPTION 'all supplier assignments must share the request response deadline' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_assignment_response_deadline() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bridge_private.enforce_request_assignment_deadlines() FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER assignment_response_deadline_matches_request
AFTER INSERT OR UPDATE OF "quoteRequestId", "expiresAt" ON bridge_ai."SupplierAssignment"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_assignment_response_deadline();

CREATE CONSTRAINT TRIGGER request_response_deadline_matches_assignments
AFTER UPDATE OF "responseDueAt" ON bridge_ai."QuoteRequest"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_request_assignment_deadlines();
