-- Supplier requests use a 48-hour response clock. Submitted prices
-- remain selectable for at least seven days, even if a client bypasses the
-- Next.js route and writes through another permitted database path.

UPDATE bridge_ai."MatchingConfiguration"
SET "responseDeadlineHours" = 48,
    "updatedAt" = now()
WHERE id = 'default';

CREATE OR REPLACE FUNCTION bridge_private.enforce_minimum_quotation_validity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  effective_submitted_at timestamptz;
  minimum_valid_until timestamptz;
BEGIN
  IF NEW.status <> 'SUBMITTED' THEN
    RETURN NEW;
  END IF;

  effective_submitted_at := coalesce(NEW."submittedAt", now());
  minimum_valid_until := effective_submitted_at + interval '7 days';

  IF NEW."validUntil" IS NULL OR NEW."validUntil" < minimum_valid_until THEN
    NEW."validUntil" := minimum_valid_until;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_minimum_quotation_validity()
  FROM PUBLIC, anon, authenticated, service_role, bridge_ai_app;

DROP TRIGGER IF EXISTS supplier_quotation_minimum_validity
  ON bridge_ai."SupplierQuotation";
CREATE TRIGGER supplier_quotation_minimum_validity
  BEFORE INSERT OR UPDATE OF status, "submittedAt", "validUntil"
  ON bridge_ai."SupplierQuotation"
  FOR EACH ROW
  EXECUTE FUNCTION bridge_private.enforce_minimum_quotation_validity();

UPDATE bridge_ai."SupplierQuotation"
SET "validUntil" = "submittedAt" + interval '7 days'
WHERE status = 'SUBMITTED'
  AND "submittedAt" IS NOT NULL
  AND (
    "validUntil" IS NULL
    OR "validUntil" < "submittedAt" + interval '7 days'
  );

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'system_quote_timing_20260810212559',
  'SYSTEM.QUOTE_TIMING_POLICY_UPDATED',
  'MatchingConfiguration',
  'default',
  'Set supplier response windows to 48 hours and quotation validity to at least seven days',
  jsonb_build_object(
    'supplierResponseHours', 48,
    'minimumQuotationValidityDays', 7,
    'weekendPause', 'Friday 15:00 to Monday 08:00 Europe/London'
  ),
  now()
) ON CONFLICT (id) DO NOTHING;
