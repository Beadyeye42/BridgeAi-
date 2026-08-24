-- Production geographic boundary hardening.
--
-- The previous implementation allowed a 0.01-mile (52.8-foot) tolerance at
-- paid plan boundaries. Keep only a 0.0001-mile numerical tolerance (about
-- 6.3 inches) for coordinates stored to six decimal places. This is not a
-- commercial extension of any membership radius.
DO $radius_hardening$
DECLARE
  target_function regprocedure;
  current_definition text;
  hardened_definition text;
BEGIN
  FOREACH target_function IN ARRAY ARRAY[
    'bridge_private.enforce_coverage_membership_limit()'::regprocedure,
    'bridge_private.enforce_automatic_assignment_limits()'::regprocedure,
    'bridge_private.reconcile_supplier_geographic_membership(text)'::regprocedure,
    'bridge_private.supplier_assignment_within_active_geography(text,text)'::regprocedure
  ]
  LOOP
    SELECT pg_get_functiondef(target_function)
      INTO current_definition;
    hardened_definition := replace(current_definition, '+ 0.01', '+ 0.0001');
    IF hardened_definition = current_definition THEN
      RAISE EXCEPTION 'Expected legacy geographic tolerance in %', target_function;
    END IF;
    EXECUTE hardened_definition;
  END LOOP;
END;
$radius_hardening$;

-- An approved supplier must always have one internally consistent, verified
-- business base. Postcode lookups happen on the trusted server; this trigger
-- prevents any write path from changing the public postcode while retaining
-- stale origin coordinates from a different postcode.
CREATE OR REPLACE FUNCTION bridge_private.enforce_approved_supplier_verified_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $verified_location$
BEGIN
  IF NEW.status = 'APPROVED' AND (
    nullif(btrim(NEW.postcode), '') IS NULL
    OR nullif(btrim(NEW."geographicOriginPostcode"), '') IS NULL
    OR upper(regexp_replace(NEW.postcode, '\s+', '', 'g'))
       <> upper(regexp_replace(NEW."geographicOriginPostcode", '\s+', '', 'g'))
    OR NEW."geographicOriginLatitude" IS NULL
    OR NEW."geographicOriginLongitude" IS NULL
    OR NEW."geographicOriginLatitude" NOT BETWEEN -90 AND 90
    OR NEW."geographicOriginLongitude" NOT BETWEEN -180 AND 180
  ) THEN
    RAISE EXCEPTION 'VERIFIED_COMPANY_POSTCODE_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$verified_location$;

REVOKE ALL ON FUNCTION bridge_private.enforce_approved_supplier_verified_location()
  FROM PUBLIC, anon, authenticated, service_role, bridge_ai_app;

DROP TRIGGER IF EXISTS enforce_approved_supplier_verified_location
  ON bridge_ai.supplier_companies;
CREATE TRIGGER enforce_approved_supplier_verified_location
  BEFORE INSERT OR UPDATE OF status, postcode, "geographicOriginPostcode",
    "geographicOriginLatitude", "geographicOriginLongitude"
  ON bridge_ai.supplier_companies
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_approved_supplier_verified_location();

-- Preserve every base change with old/new values. Repeated changes are raised
-- as warnings in the administrator system-events console for investigation.
CREATE OR REPLACE FUNCTION bridge_private.audit_supplier_geographic_base_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $geographic_base_audit$
DECLARE
  recent_change_count integer;
  event_severity bridge_ai."SystemEventSeverity";
  event_code text;
BEGIN
  IF upper(regexp_replace(coalesce(NEW."geographicOriginPostcode", ''), '\s+', '', 'g'))
       = upper(regexp_replace(coalesce(OLD."geographicOriginPostcode", ''), '\s+', '', 'g'))
     AND NEW."geographicOriginLatitude" IS NOT DISTINCT FROM OLD."geographicOriginLatitude"
     AND NEW."geographicOriginLongitude" IS NOT DISTINCT FROM OLD."geographicOriginLongitude" THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::integer INTO recent_change_count
  FROM bridge_ai."AuditLog"
  WHERE "supplierCompanyId" = NEW.id
    AND action = 'SUPPLIER.GEOGRAPHIC_BASE_CHANGED'
    AND "createdAt" >= now() - interval '30 days';

  INSERT INTO bridge_ai."AuditLog" (
    id, "actorUserId", "supplierCompanyId", action, "entityType", "entityId",
    summary, metadata, "createdAt"
  ) VALUES (
    'geographic_base_audit_' || replace(gen_random_uuid()::text, '-', ''),
    bridge_private.current_user_id(),
    NEW.id,
    'SUPPLIER.GEOGRAPHIC_BASE_CHANGED',
    'SupplierCompany',
    NEW.id,
    'Supplier verified business location changed and geographic eligibility was reconciled',
    jsonb_build_object(
      'old', jsonb_build_object(
        'postcode', OLD."geographicOriginPostcode",
        'latitude', OLD."geographicOriginLatitude",
        'longitude', OLD."geographicOriginLongitude"
      ),
      'new', jsonb_build_object(
        'postcode', NEW."geographicOriginPostcode",
        'latitude', NEW."geographicOriginLatitude",
        'longitude', NEW."geographicOriginLongitude"
      ),
      'recentPreviousChanges', recent_change_count,
      'reconciliationTriggered', true
    ),
    now()
  );

  event_severity := CASE WHEN recent_change_count >= 2 THEN 'WARNING' ELSE 'INFO' END;
  event_code := CASE WHEN recent_change_count >= 2
    THEN 'SUPPLIER_REPEATED_GEOGRAPHIC_BASE_CHANGES'
    ELSE 'SUPPLIER_GEOGRAPHIC_BASE_CHANGED'
  END;

  INSERT INTO bridge_ai."SystemEvent" (
    id, severity, source, code, message, context, "occurredAt"
  ) VALUES (
    'geographic_base_event_' || replace(gen_random_uuid()::text, '-', ''),
    event_severity,
    'supplier_geography',
    event_code,
    CASE WHEN recent_change_count >= 2
      THEN 'Supplier changed its verified business base repeatedly; review the account.'
      ELSE 'Supplier changed its verified business base; geographic access was reconciled.'
    END,
    jsonb_build_object(
      'supplierCompanyId', NEW.id,
      'oldPostcode', OLD."geographicOriginPostcode",
      'newPostcode', NEW."geographicOriginPostcode",
      'recentPreviousChanges', recent_change_count
    ),
    now()
  );

  RETURN NEW;
END;
$geographic_base_audit$;

REVOKE ALL ON FUNCTION bridge_private.audit_supplier_geographic_base_change()
  FROM PUBLIC, anon, authenticated, service_role, bridge_ai_app;

DROP TRIGGER IF EXISTS audit_supplier_geographic_base_change
  ON bridge_ai.supplier_companies;
CREATE TRIGGER audit_supplier_geographic_base_change
  AFTER UPDATE OF postcode, "geographicOriginPostcode",
    "geographicOriginLatitude", "geographicOriginLongitude"
  ON bridge_ai.supplier_companies
  FOR EACH ROW EXECUTE FUNCTION bridge_private.audit_supplier_geographic_base_change();

-- Any trusted origin change now invokes the existing set-based reconciliation:
-- invalid coverage is deactivated and live unquoted assignments are withdrawn.
DROP TRIGGER IF EXISTS reconcile_geographic_membership_after_supplier_change
  ON bridge_ai.supplier_companies;
CREATE TRIGGER reconcile_geographic_membership_after_supplier_change
  AFTER UPDATE OF postcode, "geographicOriginPostcode",
    "membershipTierOverride", "maximumActiveOpportunitiesOverride",
    "maximumServiceRadiusOverride", "maximumDeliveryRadiusOverride",
    "geographicOriginLatitude", "geographicOriginLongitude"
  ON bridge_ai.supplier_companies
  FOR EACH ROW EXECUTE FUNCTION bridge_private.reconcile_geographic_membership_trigger();

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'system_production_radius_hardening_20260824161936',
  'SYSTEM.PRODUCTION_RADIUS_GEOGRAPHY_HARDENED',
  'SecurityConfiguration',
  'production-radius-geography',
  'Enforced exact paid radius boundaries and auditable verified-base reconciliation across every write path',
  jsonb_build_object(
    'boundaryToleranceMiles', 0.0001,
    'basePostcodeMustMatchOrigin', true,
    'baseChangesAudited', true,
    'repeatedChangesAlerted', true,
    'coverageReconciled', true,
    'assignmentsReconciled', true
  ),
  now()
) ON CONFLICT (id) DO NOTHING;
