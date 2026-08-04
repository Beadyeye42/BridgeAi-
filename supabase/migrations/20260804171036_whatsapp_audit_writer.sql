-- AuditLog is append-only and remains inaccessible to unauthenticated workers.
-- This narrow writer is the sole RLS bypass used by verified WhatsApp ingestion.
DROP POLICY IF EXISTS whatsapp_worker_audit_insert ON bridge_ai."AuditLog";

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
     OR current_setting('bridge_ai.worker_context', true) <> 'whatsapp_webhook' THEN
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
