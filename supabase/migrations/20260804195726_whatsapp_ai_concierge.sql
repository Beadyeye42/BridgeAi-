-- Durable, least-privilege processing for the WhatsApp AI concierge.
-- External API calls happen outside database transactions; this queue records
-- every attempt without exposing customer content to portal users.
CREATE TYPE bridge_ai."AiConversationStage" AS ENUM (
  'CONSENT_REQUIRED',
  'COLLECTING',
  'AWAITING_CONFIRMATION',
  'QUOTE_CREATED',
  'AWAITING_SELECTION',
  'SELECTION_RECORDED',
  'HUMAN_REVIEW',
  'CLOSED'
);

CREATE TYPE bridge_ai."WhatsAppJobType" AS ENUM (
  'PROCESS_INBOUND',
  'SEND_QUOTE_SUMMARY'
);

CREATE TYPE bridge_ai."WhatsAppJobStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
);

ALTER TABLE bridge_ai."Conversation"
  ADD COLUMN "aiStage" bridge_ai."AiConversationStage" NOT NULL DEFAULT 'CONSENT_REQUIRED',
  ADD COLUMN "aiConsentAt" timestamptz,
  ADD COLUMN "aiDraftEncrypted" bytea;

ALTER TABLE bridge_ai."WhatsAppMessage"
  ADD COLUMN "mediaIdEncrypted" bytea,
  ADD COLUMN "mediaMimeType" text,
  ADD COLUMN "mediaFileNameEncrypted" bytea;

CREATE TABLE bridge_ai."WhatsAppJob" (
  id text PRIMARY KEY,
  type bridge_ai."WhatsAppJobType" NOT NULL,
  status bridge_ai."WhatsAppJobStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" text NOT NULL UNIQUE,
  "conversationId" text REFERENCES bridge_ai."Conversation"(id) ON DELETE CASCADE,
  "whatsappMessageId" text REFERENCES bridge_ai."WhatsAppMessage"(id) ON DELETE CASCADE,
  "quoteRequestId" text REFERENCES bridge_ai."QuoteRequest"(id) ON DELETE CASCADE,
  "quotationId" text REFERENCES bridge_ai."SupplierQuotation"(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  "availableAt" timestamptz NOT NULL DEFAULT now(),
  "lockedAt" timestamptz,
  "completedAt" timestamptz,
  "failedAt" timestamptz,
  "errorCode" text,
  model text,
  "providerResponseIdHash" text,
  "inputTokens" integer,
  "outputTokens" integer,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_job_attempts_valid CHECK (attempts BETWEEN 0 AND 10),
  CONSTRAINT whatsapp_job_parent_valid CHECK (
    (type = 'PROCESS_INBOUND'
      AND "conversationId" IS NOT NULL
      AND "whatsappMessageId" IS NOT NULL
      AND "quoteRequestId" IS NULL
      AND "quotationId" IS NULL)
    OR
    (type = 'SEND_QUOTE_SUMMARY'
      AND "conversationId" IS NOT NULL
      AND "whatsappMessageId" IS NULL
      AND "quoteRequestId" IS NOT NULL
      AND "quotationId" IS NOT NULL)
  )
);

CREATE INDEX whatsapp_job_claim_idx
  ON bridge_ai."WhatsAppJob" (status, "availableAt", "createdAt");
CREATE INDEX whatsapp_job_conversation_idx
  ON bridge_ai."WhatsAppJob" ("conversationId", "createdAt");
CREATE INDEX whatsapp_job_request_idx
  ON bridge_ai."WhatsAppJob" ("quoteRequestId", "createdAt");
CREATE INDEX whatsapp_job_quotation_idx
  ON bridge_ai."WhatsAppJob" ("quotationId");

ALTER TABLE bridge_ai."WhatsAppJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."WhatsAppJob" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bridge_ai."WhatsAppJob" FROM PUBLIC, anon, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE bridge_ai."WhatsAppJob" TO authenticated;

CREATE POLICY whatsapp_webhook_job_insert
  ON bridge_ai."WhatsAppJob" FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('whatsapp_webhook'))
    AND type = 'PROCESS_INBOUND'
    AND status = 'PENDING'
  );

CREATE POLICY whatsapp_ai_job_select
  ON bridge_ai."WhatsAppJob" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_job_insert
  ON bridge_ai."WhatsAppJob" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_job_update
  ON bridge_ai."WhatsAppJob" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));

CREATE POLICY whatsapp_ai_customer_select
  ON bridge_ai."CustomerContact" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_customer_update
  ON bridge_ai."CustomerContact" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));

CREATE POLICY whatsapp_ai_conversation_select
  ON bridge_ai."Conversation" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_conversation_update
  ON bridge_ai."Conversation" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));

CREATE POLICY whatsapp_ai_message_select
  ON bridge_ai."WhatsAppMessage" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_message_insert
  ON bridge_ai."WhatsAppMessage" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_message_update
  ON bridge_ai."WhatsAppMessage" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));

CREATE POLICY whatsapp_ai_attachment_select
  ON bridge_ai."Attachment" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_attachment_insert
  ON bridge_ai."Attachment" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_attachment_update
  ON bridge_ai."Attachment" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));

CREATE POLICY whatsapp_ai_category_select
  ON bridge_ai."ProductCategory" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')) AND active);
CREATE POLICY whatsapp_ai_request_select
  ON bridge_ai."QuoteRequest" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_request_insert
  ON bridge_ai."QuoteRequest" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_request_update
  ON bridge_ai."QuoteRequest" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_item_select
  ON bridge_ai."QuoteRequestItem" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_item_insert
  ON bridge_ai."QuoteRequestItem" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_quotation_select
  ON bridge_ai."SupplierQuotation" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_assignment_select
  ON bridge_ai."SupplierAssignment" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY whatsapp_ai_system_event_insert
  ON bridge_ai."SystemEvent" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')) AND source = 'whatsapp_ai');

-- Extend the existing narrow audit writer to the AI worker. It still rejects
-- non-WhatsApp actions and cannot be invoked by portal or API roles.
CREATE OR REPLACE FUNCTION bridge_private.write_whatsapp_audit(
  audit_action text,
  entity_type text,
  entity_id text,
  audit_summary text,
  audit_metadata jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $$
DECLARE
  audit_id text := 'audit_' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF session_user <> 'bridge_ai_app'
     OR current_setting('bridge_ai.worker_context', true) NOT IN ('whatsapp_webhook', 'whatsapp_ai') THEN
    RAISE EXCEPTION 'trusted WhatsApp worker required' USING ERRCODE = '42501';
  END IF;
  IF audit_action NOT LIKE 'WHATSAPP.%' THEN
    RAISE EXCEPTION 'invalid WhatsApp audit action' USING ERRCODE = '22023';
  END IF;

  INSERT INTO bridge_ai."AuditLog" (
    id, action, "entityType", "entityId", summary, metadata, "createdAt"
  ) VALUES (
    audit_id, audit_action, entity_type, entity_id, audit_summary, audit_metadata, now()
  );
  RETURN audit_id;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.write_whatsapp_audit(text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridge_ai_app') THEN
    GRANT EXECUTE ON FUNCTION bridge_private.write_whatsapp_audit(text, text, text, text, jsonb)
      TO bridge_ai_app;
  END IF;
END
$$;
