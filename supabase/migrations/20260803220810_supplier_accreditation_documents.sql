ALTER TYPE bridge_ai."AttachmentKind" ADD VALUE IF NOT EXISTS 'ACCREDITATION_DOCUMENT';

CREATE TYPE bridge_ai."AccreditationType" AS ENUM (
  'PUBLIC_LIABILITY_INSURANCE',
  'EMPLOYERS_LIABILITY_INSURANCE',
  'PROFESSIONAL_INDEMNITY_INSURANCE',
  'TRADE_BODY_MEMBERSHIP',
  'CERTIFICATION',
  'OTHER'
);

CREATE TYPE bridge_ai."AccreditationStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED'
);

CREATE TABLE bridge_ai.supplier_accreditations (
  id text PRIMARY KEY,
  "supplierCompanyId" text NOT NULL,
  "attachmentId" text NOT NULL UNIQUE,
  type bridge_ai."AccreditationType" NOT NULL,
  "displayName" text NOT NULL,
  "referenceNumber" text,
  "issuingBody" text,
  "issuedAt" timestamptz(3),
  "expiresAt" timestamptz(3),
  status bridge_ai."AccreditationStatus" NOT NULL DEFAULT 'PENDING',
  "reviewNote" text,
  "reviewedAt" timestamptz(3),
  "reviewedById" uuid,
  "createdById" uuid NOT NULL,
  "createdAt" timestamptz(3) NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz(3) NOT NULL DEFAULT current_timestamp,
  CONSTRAINT supplier_accreditations_company_fkey
    FOREIGN KEY ("supplierCompanyId") REFERENCES bridge_ai.supplier_companies(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT supplier_accreditations_attachment_fkey
    FOREIGN KEY ("attachmentId") REFERENCES bridge_ai."Attachment"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT supplier_accreditations_reviewer_fkey
    FOREIGN KEY ("reviewedById") REFERENCES bridge_ai.portal_profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT supplier_accreditations_creator_fkey
    FOREIGN KEY ("createdById") REFERENCES bridge_ai.portal_profiles(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT supplier_accreditations_name_valid
    CHECK (char_length(btrim("displayName")) BETWEEN 2 AND 160),
  CONSTRAINT supplier_accreditations_reference_valid
    CHECK ("referenceNumber" IS NULL OR char_length("referenceNumber") <= 120),
  CONSTRAINT supplier_accreditations_issuer_valid
    CHECK ("issuingBody" IS NULL OR char_length("issuingBody") <= 160),
  CONSTRAINT supplier_accreditations_date_sequence
    CHECK ("issuedAt" IS NULL OR "expiresAt" IS NULL OR "expiresAt" >= "issuedAt"),
  CONSTRAINT supplier_accreditations_review_state_valid
    CHECK (
      (status = 'PENDING' AND "reviewedAt" IS NULL AND "reviewedById" IS NULL)
      OR (status <> 'PENDING' AND "reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL)
    )
);

CREATE INDEX supplier_accreditations_company_status_idx
  ON bridge_ai.supplier_accreditations ("supplierCompanyId", status, "expiresAt");
CREATE INDEX supplier_accreditations_reviewer_idx
  ON bridge_ai.supplier_accreditations ("reviewedById");
CREATE INDEX supplier_accreditations_creator_idx
  ON bridge_ai.supplier_accreditations ("createdById");

ALTER TABLE bridge_ai.supplier_accreditations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai.supplier_accreditations FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_administrator_all
ON bridge_ai.supplier_accreditations
FOR ALL TO authenticated
USING ((SELECT bridge_private.is_platform_admin()))
WITH CHECK ((SELECT bridge_private.is_platform_admin()));

CREATE POLICY accreditation_company_read
ON bridge_ai.supplier_accreditations
FOR SELECT TO authenticated
USING ((SELECT bridge_private.has_company_membership("supplierCompanyId")));

CREATE POLICY accreditation_company_insert
ON bridge_ai.supplier_accreditations
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT bridge_private.has_company_membership(
    "supplierCompanyId",
    ARRAY['OWNER','MANAGER']::bridge_ai."SupplierTeamRole"[]
  ))
  AND "createdById" = (SELECT auth.uid())
  AND status = 'PENDING'
  AND "reviewedAt" IS NULL
  AND "reviewedById" IS NULL
  AND "reviewNote" IS NULL
);

CREATE POLICY accreditation_company_delete_unreviewed
ON bridge_ai.supplier_accreditations
FOR DELETE TO authenticated
USING (
  status IN ('PENDING', 'REJECTED')
  AND (SELECT bridge_private.has_company_membership(
    "supplierCompanyId",
    ARRAY['OWNER','MANAGER']::bridge_ai."SupplierTeamRole"[]
  ))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON bridge_ai.supplier_accreditations
  TO authenticated, service_role;
GRANT USAGE ON TYPE bridge_ai."AccreditationType", bridge_ai."AccreditationStatus"
  TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridge_ai_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON bridge_ai.supplier_accreditations TO bridge_ai_app;
    GRANT USAGE ON TYPE bridge_ai."AccreditationType", bridge_ai."AccreditationStatus" TO bridge_ai_app;
  END IF;
END $$;
