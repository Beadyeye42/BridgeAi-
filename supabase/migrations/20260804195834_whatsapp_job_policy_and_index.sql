-- Cover the inbound-message foreign key and combine the two trusted worker
-- insert paths so each queue insert evaluates one permissive policy.
CREATE INDEX whatsapp_job_message_idx
  ON bridge_ai."WhatsAppJob" ("whatsappMessageId");

DROP POLICY whatsapp_webhook_job_insert ON bridge_ai."WhatsAppJob";
DROP POLICY whatsapp_ai_job_insert ON bridge_ai."WhatsAppJob";

CREATE POLICY whatsapp_job_insert
  ON bridge_ai."WhatsAppJob" FOR INSERT TO authenticated
  WITH CHECK (
    (
      (SELECT bridge_private.is_trusted_worker('whatsapp_webhook'))
      AND type = 'PROCESS_INBOUND'
      AND status = 'PENDING'
    )
    OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
  );
