DROP POLICY IF EXISTS supplier_opportunity_scoped_read ON bridge_ai."SupplierOpportunity";
CREATE POLICY supplier_opportunity_scoped_read
  ON bridge_ai."SupplierOpportunity" FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_platform_admin())
    OR EXISTS (
      SELECT 1 FROM bridge_ai."SupplierAssignment" assignment
      WHERE assignment."quoteRequestId" = bridge_ai."SupplierOpportunity"."quoteRequestId"
        AND (SELECT bridge_private.has_company_membership(assignment."supplierCompanyId"))
    )
  );

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_supplier_opportunity_scope_fix_v1',
  'SYSTEM.SUPPLIER_OPPORTUNITY_SCOPE_FIXED',
  'SupplierOpportunity',
  'supplier_opportunity_scoped_read',
  'Supplier opportunity visibility restricted to assigned companies',
  jsonb_build_object('maximumSelectedSuppliers', 3),
  now()
) ON CONFLICT (id) DO NOTHING;
