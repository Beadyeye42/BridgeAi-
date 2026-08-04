-- Allow the verified server-side WhatsApp worker to persist inbound events
-- without weakening customer or supplier access through the Data API.
CREATE OR REPLACE FUNCTION bridge_private.is_trusted_worker(worker_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT session_user = 'bridge_ai_app'
     AND current_setting('bridge_ai.worker_context', true) = worker_name
$$;

REVOKE ALL ON FUNCTION bridge_private.is_trusted_worker(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.is_trusted_worker(text) TO authenticated;

CREATE POLICY whatsapp_worker_webhook_event_select
  ON bridge_ai."WebhookEvent" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')));
CREATE POLICY whatsapp_worker_webhook_event_insert
  ON bridge_ai."WebhookEvent" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')));
CREATE POLICY whatsapp_worker_webhook_event_update
  ON bridge_ai."WebhookEvent" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')));

CREATE POLICY whatsapp_worker_customer_select
  ON bridge_ai."CustomerContact" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')));
CREATE POLICY whatsapp_worker_customer_insert
  ON bridge_ai."CustomerContact" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')));
CREATE POLICY whatsapp_worker_customer_update
  ON bridge_ai."CustomerContact" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')));

CREATE POLICY whatsapp_worker_conversation_select
  ON bridge_ai."Conversation" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')));
CREATE POLICY whatsapp_worker_conversation_insert
  ON bridge_ai."Conversation" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')));
CREATE POLICY whatsapp_worker_conversation_update
  ON bridge_ai."Conversation" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')));

CREATE POLICY whatsapp_worker_message_select
  ON bridge_ai."WhatsAppMessage" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')));
CREATE POLICY whatsapp_worker_message_insert
  ON bridge_ai."WhatsAppMessage" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')));
CREATE POLICY whatsapp_worker_message_update
  ON bridge_ai."WhatsAppMessage" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')));

CREATE POLICY whatsapp_worker_audit_insert
  ON bridge_ai."AuditLog" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_webhook')));
