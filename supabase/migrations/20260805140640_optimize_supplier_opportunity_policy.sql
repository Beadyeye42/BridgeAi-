-- A single SELECT policy avoids evaluating two permissive policies for every
-- marketplace row while preserving the administrator bypass.
DROP POLICY supplier_opportunity_approved_read
  ON bridge_ai."SupplierOpportunity";
DROP POLICY supplier_opportunity_admin_read
  ON bridge_ai."SupplierOpportunity";

CREATE POLICY supplier_opportunity_read
  ON bridge_ai."SupplierOpportunity" FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_platform_admin())
    OR (
      (SELECT bridge_private.can_browse_supplier_opportunities())
      AND status IN ('OPEN', 'MATCHING', 'QUOTED')
      AND "responseDueAt" > now()
    )
  );
