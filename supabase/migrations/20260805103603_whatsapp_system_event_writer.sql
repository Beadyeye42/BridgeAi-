-- RLS is still forced on SystemEvent for every ordinary query. Trusted
-- WhatsApp workers use this narrow writer so a failed alert cannot leave the
-- durable queue permanently blocked. Portal, anon and service roles cannot
-- execute it, and the source must match the active worker context.
CREATE OR REPLACE FUNCTION bridge_private.write_whatsapp_system_event(
  event_severity bridge_ai."SystemEventSeverity",
  event_source text,
  event_code text,
  event_message text,
  event_context jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $$
DECLARE
  worker_name text := current_setting('bridge_ai.worker_context', true);
  event_id text := 'event_' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF session_user <> 'bridge_ai_app'
     OR worker_name NOT IN ('whatsapp_webhook', 'whatsapp_ai') THEN
    RAISE EXCEPTION 'trusted WhatsApp worker required' USING ERRCODE = '42501';
  END IF;
  IF event_source <> worker_name
     OR event_code !~ '^[A-Z0-9_]{3,120}$'
     OR length(btrim(event_message)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid WhatsApp system event' USING ERRCODE = '22023';
  END IF;

  INSERT INTO bridge_ai."SystemEvent" (
    id, severity, source, code, message, context, "occurredAt"
  ) VALUES (
    event_id, event_severity, event_source, event_code, event_message,
    COALESCE(event_context, '{}'::jsonb), now()
  );
  RETURN event_id;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.write_whatsapp_system_event(
  bridge_ai."SystemEventSeverity", text, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION bridge_private.write_whatsapp_system_event(
  bridge_ai."SystemEventSeverity", text, text, text, jsonb
) TO bridge_ai_app;
