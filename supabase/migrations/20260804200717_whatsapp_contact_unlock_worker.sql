ALTER TABLE bridge_ai."WhatsAppJob"
  DROP CONSTRAINT whatsapp_job_parent_valid,
  ADD CONSTRAINT whatsapp_job_parent_valid CHECK (
    (type = 'PROCESS_INBOUND'
      AND "conversationId" IS NOT NULL
      AND "whatsappMessageId" IS NOT NULL
      AND "quoteRequestId" IS NULL
      AND "quotationId" IS NULL)
    OR
    (type IN ('SEND_QUOTE_SUMMARY', 'SEND_CONTACT_UNLOCK')
      AND "conversationId" IS NOT NULL
      AND "whatsappMessageId" IS NULL
      AND "quoteRequestId" IS NOT NULL
      AND "quotationId" IS NOT NULL)
  );

CREATE POLICY whatsapp_ai_supplier_select
  ON bridge_ai.supplier_companies FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_success_fee_select
  ON bridge_ai."SupplierSuccessFee" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_contact_grant_select
  ON bridge_ai."ContactAccessGrant" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_contact_grant_update
  ON bridge_ai."ContactAccessGrant" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
