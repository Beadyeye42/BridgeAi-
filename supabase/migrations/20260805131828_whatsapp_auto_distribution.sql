-- A customer upload must retain its WhatsApp message provenance after the
-- confirmed request claims it. Supplier and administrator uploads keep the
-- original single-parent rule.
ALTER TABLE bridge_ai."Attachment"
  DROP CONSTRAINT attachment_exactly_one_parent,
  ADD CONSTRAINT attachment_exactly_one_parent CHECK (
    (
      "whatsappMessageId" IS NOT NULL
      AND "quotationId" IS NULL
      AND "supplierCompanyId" IS NULL
    )
    OR (
      "whatsappMessageId" IS NULL
      AND num_nonnulls("quoteRequestId", "quotationId", "supplierCompanyId") = 1
    )
  );

CREATE OR REPLACE FUNCTION bridge_private.enforce_whatsapp_attachment_quote_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  message_conversation_id text;
  message_occurred_at timestamptz;
  request_conversation_id text;
  session_started_at timestamptz;
BEGIN
  IF NEW."whatsappMessageId" IS NULL OR NEW."quoteRequestId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT message."conversationId", message."occurredAt"
    INTO message_conversation_id, message_occurred_at
  FROM bridge_ai."WhatsAppMessage" message
  WHERE message.id = NEW."whatsappMessageId";

  SELECT request."conversationId", conversation."aiSessionStartedAt"
    INTO request_conversation_id, session_started_at
  FROM bridge_ai."QuoteRequest" request
  JOIN bridge_ai."Conversation" conversation
    ON conversation.id = request."conversationId"
  WHERE request.id = NEW."quoteRequestId";

  IF message_conversation_id IS NULL
     OR request_conversation_id IS NULL
     OR message_conversation_id <> request_conversation_id
     OR message_occurred_at < session_started_at THEN
    RAISE EXCEPTION 'WhatsApp attachment does not belong to this quote intake session'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_whatsapp_attachment_quote_consistency()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER enforce_whatsapp_attachment_quote_consistency
  BEFORE INSERT OR UPDATE OF "whatsappMessageId", "quoteRequestId"
  ON bridge_ai."Attachment"
  FOR EACH ROW
  EXECUTE FUNCTION bridge_private.enforce_whatsapp_attachment_quote_consistency();

-- Matching is performed only by the trusted WhatsApp worker after a customer
-- confirms a complete request. Portal identities cannot activate this context.
CREATE POLICY whatsapp_ai_membership_match_select
  ON bridge_ai.company_memberships FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));

CREATE POLICY whatsapp_ai_supplier_category_match_select
  ON bridge_ai."SupplierProductCategory" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));

CREATE POLICY whatsapp_ai_coverage_match_select
  ON bridge_ai."CoverageArea" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')) AND active);

CREATE POLICY whatsapp_ai_accreditation_match_select
  ON bridge_ai.supplier_accreditations FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')) AND status = 'APPROVED');

CREATE POLICY whatsapp_ai_subscription_match_select
  ON bridge_ai."Subscription" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')) AND status = 'ACTIVE');

CREATE POLICY whatsapp_ai_assignment_insert
  ON bridge_ai."SupplierAssignment" FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
    AND "assignedById" IS NULL
    AND status = 'PENDING'
  );

CREATE POLICY whatsapp_ai_notification_insert
  ON bridge_ai."Notification" FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
    AND type = 'NEW_QUOTE_REQUEST'
    AND channel = 'IN_APP'
    AND "supplierCompanyId" IS NOT NULL
  );

CREATE POLICY whatsapp_ai_notification_preference_select
  ON bridge_ai."NotificationPreference" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
