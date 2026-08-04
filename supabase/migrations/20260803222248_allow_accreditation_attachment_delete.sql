CREATE POLICY attachment_company_accreditation_delete
ON bridge_ai."Attachment"
FOR DELETE TO authenticated
USING (
  kind = 'ACCREDITATION_DOCUMENT'
  AND "supplierCompanyId" IS NOT NULL
  AND (SELECT bridge_private.has_company_membership(
    "supplierCompanyId",
    ARRAY['OWNER','MANAGER']::bridge_ai."SupplierTeamRole"[]
  ))
  AND EXISTS (
    SELECT 1
    FROM bridge_ai.supplier_accreditations accreditation
    WHERE accreditation."attachmentId" = bridge_ai."Attachment".id
      AND accreditation.status IN ('PENDING', 'REJECTED')
  )
);
