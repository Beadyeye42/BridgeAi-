-- Supplier logo bytes are replaced through Storage upsert. Replace the
-- corresponding immutable metadata row by deleting/recreating it, rather than
-- granting suppliers broad UPDATE access to attachment scan state or ownership.
CREATE POLICY attachment_company_logo_delete
ON bridge_ai."Attachment"
FOR DELETE TO authenticated
USING (
  kind = 'SUPPLIER_LOGO'
  AND "supplierCompanyId" IS NOT NULL
  AND (SELECT bridge_private.has_company_membership("supplierCompanyId"))
);
