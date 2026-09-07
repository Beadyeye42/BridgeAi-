-- Suppliers may edit their business profile, but only a verified platform
-- administrator may alter approval/suspension state. Approval also requires a
-- complete, currently valid onboarding record.
CREATE OR REPLACE FUNCTION bridge_private.enforce_supplier_review_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT (SELECT bridge_private.is_platform_admin())
     AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
       OR NEW."approvedById" IS DISTINCT FROM OLD."approvedById"
       OR NEW."suspendedAt" IS DISTINCT FROM OLD."suspendedAt"
       OR NEW."suspensionNote" IS DISTINCT FROM OLD."suspensionNote"
     ) THEN
    RAISE EXCEPTION 'supplier review state can only be changed by a platform administrator'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'APPROVED' AND OLD.status IS DISTINCT FROM 'APPROVED' THEN
    IF length(btrim(COALESCE(NEW."addressLine1", ''))) = 0
       OR length(btrim(COALESCE(NEW.city, ''))) = 0
       OR length(btrim(COALESCE(NEW.postcode, ''))) < 3
       OR length(btrim(COALESCE(NEW.summary, ''))) < 20
       OR NEW."approvedAt" IS NULL
       OR NEW."approvedById" IS NULL
       OR COALESCE(jsonb_typeof(NEW."businessHours"), '') <> 'object'
       OR NOT EXISTS (
         SELECT 1
         FROM jsonb_each(CASE WHEN jsonb_typeof(NEW."businessHours") = 'object' THEN NEW."businessHours" ELSE '{}'::jsonb END) AS hours(day, value)
         WHERE jsonb_typeof(value) = 'array' AND jsonb_array_length(value) = 2
       )
       OR NOT EXISTS (
         SELECT 1 FROM bridge_ai."SupplierProductCategory"
         WHERE "supplierCompanyId" = NEW.id
       )
       OR NOT EXISTS (
         SELECT 1 FROM bridge_ai."CoverageArea"
         WHERE "supplierCompanyId" = NEW.id AND active
       )
       OR NOT EXISTS (
         SELECT 1 FROM bridge_ai.company_memberships
         WHERE "supplierCompanyId" = NEW.id AND role = 'OWNER' AND status = 'ACTIVE'
       )
       OR NOT EXISTS (
         SELECT 1
         FROM bridge_ai.supplier_accreditations accreditation
         JOIN bridge_ai."Attachment" attachment ON attachment.id = accreditation."attachmentId"
         WHERE accreditation."supplierCompanyId" = NEW.id
           AND accreditation.status = 'APPROVED'
           AND attachment."scanStatus" = 'CLEAN'
           AND (accreditation."expiresAt" IS NULL OR accreditation."expiresAt" > now())
       ) THEN
      RAISE EXCEPTION 'supplier approval requirements are incomplete'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_supplier_review_state() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_supplier_review_state ON bridge_ai.supplier_companies;
CREATE TRIGGER enforce_supplier_review_state
  BEFORE UPDATE ON bridge_ai.supplier_companies
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_supplier_review_state();

-- Extend the existing worker policies instead of adding overlapping permissive
-- policies. Administrators can inspect and retry jobs, but cannot insert them.
DROP POLICY whatsapp_job_select ON bridge_ai."WhatsAppJob";
CREATE POLICY whatsapp_job_select
  ON bridge_ai."WhatsAppJob" FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_platform_admin())
    OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
    OR (
      (SELECT bridge_private.is_trusted_worker('whatsapp_webhook'))
      AND type = 'PROCESS_INBOUND'
    )
  );

DROP POLICY whatsapp_ai_job_update ON bridge_ai."WhatsAppJob";
CREATE POLICY whatsapp_ai_job_update
  ON bridge_ai."WhatsAppJob" FOR UPDATE TO authenticated
  USING (
    (SELECT bridge_private.is_platform_admin())
    OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
  )
  WITH CHECK (
    (SELECT bridge_private.is_platform_admin())
    OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
  );

-- Both trusted WhatsApp workers may emit narrowly sourced system alerts.
DROP POLICY whatsapp_ai_system_event_insert ON bridge_ai."SystemEvent";
CREATE POLICY whatsapp_worker_system_event_insert
  ON bridge_ai."SystemEvent" FOR INSERT TO authenticated
  WITH CHECK (
    (
      (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
      AND source = 'whatsapp_ai'
    )
    OR (
      (SELECT bridge_private.is_trusted_worker('whatsapp_webhook'))
      AND source = 'whatsapp_webhook'
    )
  );
