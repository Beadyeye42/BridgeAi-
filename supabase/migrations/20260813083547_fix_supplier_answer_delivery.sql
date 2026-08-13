-- Supplier answers were being saved, but their SEND_QUOTE_MESSAGE queue rows
-- were rejected by the legacy parent-shape constraint. Permit the new job
-- shape explicitly and keep every other job type unambiguous.
ALTER TABLE bridge_ai."WhatsAppJob"
  DROP CONSTRAINT whatsapp_job_parent_valid,
  ADD CONSTRAINT whatsapp_job_parent_valid CHECK (
    (type = 'PROCESS_INBOUND'
      AND "conversationId" IS NOT NULL
      AND "whatsappMessageId" IS NOT NULL
      AND "quoteRequestId" IS NULL
      AND "quotationId" IS NULL
      AND "quoteMessageId" IS NULL)
    OR
    (type = 'SEND_INTAKE_FALLBACK'
      AND "conversationId" IS NOT NULL
      AND "whatsappMessageId" IS NULL
      AND "quoteRequestId" IS NULL
      AND "quotationId" IS NULL
      AND "quoteMessageId" IS NULL)
    OR
    (type IN ('SEND_QUOTE_SUMMARY', 'SEND_CONTACT_UNLOCK')
      AND "conversationId" IS NOT NULL
      AND "whatsappMessageId" IS NULL
      AND "quoteRequestId" IS NOT NULL
      AND "quotationId" IS NOT NULL
      AND "quoteMessageId" IS NULL)
    OR
    (type = 'SEND_QUOTE_MESSAGE'
      AND "conversationId" IS NOT NULL
      AND "whatsappMessageId" IS NULL
      AND "quoteRequestId" IS NOT NULL
      AND "quotationId" IS NULL
      AND "quoteMessageId" IS NOT NULL)
  );

-- The application now creates the supplier answer and its outbound job in one
-- transaction. Suppliers may only enqueue their own pending answer for their
-- own company conversation; they cannot read or manage queue rows.
DROP POLICY IF EXISTS whatsapp_supplier_quote_message_job_insert ON bridge_ai."WhatsAppJob";
CREATE POLICY whatsapp_supplier_quote_message_job_insert
  ON bridge_ai."WhatsAppJob"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    type = 'SEND_QUOTE_MESSAGE'
    AND status = 'PENDING'
    AND "conversationId" IS NOT NULL
    AND "whatsappMessageId" IS NULL
    AND "quoteRequestId" IS NOT NULL
    AND "quotationId" IS NULL
    AND "quoteMessageId" IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM bridge_ai."QuoteMessage" message
      JOIN bridge_ai."QuoteConversation" conversation
        ON conversation.id = message."quoteConversationId"
      JOIN bridge_ai."QuoteRequest" request
        ON request.id = conversation."quoteRequestId"
      WHERE message.id = "WhatsAppJob"."quoteMessageId"
        AND message.sender = 'SUPPLIER'
        AND message.status = 'PENDING'
        AND message."senderUserId" = (SELECT bridge_private.current_user_id())
        AND conversation.status = 'OPEN'
        AND conversation."quoteRequestId" = "WhatsAppJob"."quoteRequestId"
        AND request."conversationId" = "WhatsAppJob"."conversationId"
        AND (SELECT bridge_private.has_company_membership(conversation."supplierCompanyId"))
    )
  );

-- Recover any answer that was saved while the invalid constraint was live.
DO $$
DECLARE
  repaired_count integer := 0;
BEGIN
  INSERT INTO bridge_ai."WhatsAppJob" (
    id, type, status, "idempotencyKey", "conversationId",
    "quoteRequestId", "quoteMessageId", "createdAt", "updatedAt"
  )
  SELECT
    'repair_' || replace(gen_random_uuid()::text, '-', ''),
    'SEND_QUOTE_MESSAGE',
    'PENDING',
    'quote-message:' || message.id,
    request."conversationId",
    request.id,
    message.id,
    now(),
    now()
  FROM bridge_ai."QuoteMessage" message
  JOIN bridge_ai."QuoteConversation" conversation
    ON conversation.id = message."quoteConversationId"
  JOIN bridge_ai."QuoteRequest" request
    ON request.id = conversation."quoteRequestId"
  WHERE message.sender = 'SUPPLIER'
    AND message.status = 'PENDING'
    AND request."conversationId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM bridge_ai."WhatsAppJob" job
      WHERE job."quoteMessageId" = message.id
    )
  ON CONFLICT ("idempotencyKey") DO NOTHING;

  GET DIAGNOSTICS repaired_count = ROW_COUNT;

  INSERT INTO bridge_ai."AuditLog" (
    id, action, "entityType", summary, metadata, "createdAt"
  ) VALUES (
    'system_supplier_answer_delivery_fix_20260813083547',
    'SYSTEM.SUPPLIER_ANSWER_DELIVERY_FIXED',
    'SecurityConfiguration',
    'Enabled atomic and tenant-isolated WhatsApp delivery for supplier answers',
    jsonb_build_object(
      'jobType', 'SEND_QUOTE_MESSAGE',
      'repairedJobs', repaired_count,
      'tenantIsolation', true,
      'atomicQueueing', true
    ),
    now()
  );
END
$$;
