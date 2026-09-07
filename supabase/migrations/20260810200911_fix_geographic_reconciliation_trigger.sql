-- PL/pgSQL must branch before accessing row fields that exist only on one of
-- the two trigger tables. A SQL CASE expression resolves both record fields.
CREATE OR REPLACE FUNCTION bridge_private.reconcile_geographic_membership_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_company_id text;
  result record;
BEGIN
  IF TG_TABLE_NAME = 'Subscription' THEN
    target_company_id := NEW."supplierCompanyId";
  ELSE
    target_company_id := NEW.id;
  END IF;

  SELECT * INTO result
  FROM bridge_private.reconcile_supplier_geographic_membership(target_company_id);

  IF coalesce(result.deactivated_coverage, 0) > 0 OR coalesce(result.withdrawn_assignments, 0) > 0 THEN
    INSERT INTO bridge_ai."AuditLog" (
      id, action, "entityType", "entityId", summary, metadata, "createdAt"
    ) VALUES (
      'geo_reconcile_' || replace(gen_random_uuid()::text, '-', ''),
      'MEMBERSHIP.GEOGRAPHY_RECONCILED',
      'SupplierCompany',
      target_company_id,
      'Reconciled supplier coverage and open opportunities to the current membership geography',
      jsonb_build_object(
        'deactivatedCoverage', result.deactivated_coverage,
        'withdrawnAssignments', result.withdrawn_assignments
      ),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.reconcile_geographic_membership_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
