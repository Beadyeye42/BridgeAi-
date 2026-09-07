-- Keep the operational audit append-only and inseparable from alert state.
-- The trigger runs for administrator and trusted-worker writes, while the
-- application role receives no direct access to this private function.
CREATE OR REPLACE FUNCTION bridge_private.audit_production_alert_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  audit_action text;
  audit_summary text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    audit_action := 'MONITORING.ALERTS_QUEUED';
    audit_summary := 'Production alert queued: ' || NEW.title;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'SENT' THEN
    audit_action := 'MONITORING.ALERTS_SENT';
    audit_summary := 'Production alert emailed to administrators: ' || NEW.title;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'FAILED' THEN
    audit_action := 'MONITORING.ALERT_DELIVERY_FAILED';
    audit_summary := 'Production alert delivery failed and was scheduled for retry: ' || NEW.title;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO bridge_ai."AuditLog" (
    id, action, "entityType", "entityId", summary, metadata, "createdAt"
  ) VALUES (
    'monitoring_audit_' || replace(gen_random_uuid()::text, '-', ''),
    audit_action,
    'ProductionAlert',
    NEW.id,
    audit_summary,
    jsonb_build_object(
      'fingerprint', NEW.fingerprint,
      'source', NEW.source,
      'severity', NEW.severity,
      'status', NEW.status,
      'attempts', NEW.attempts
    ),
    now()
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.audit_production_alert_change()
  FROM PUBLIC, anon, authenticated, service_role, bridge_ai_app;

DROP TRIGGER IF EXISTS production_alert_database_audit
  ON bridge_ai."ProductionAlert";
CREATE TRIGGER production_alert_database_audit
AFTER INSERT OR UPDATE OF status
ON bridge_ai."ProductionAlert"
FOR EACH ROW
EXECUTE FUNCTION bridge_private.audit_production_alert_change();

DROP POLICY production_monitoring_insert_audit_logs
  ON bridge_ai."AuditLog";

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", summary, metadata, "createdAt")
VALUES (
  'system_production_alert_database_audit_20260809152418',
  'SYSTEM.PRODUCTION_ALERT_DATABASE_AUDIT_ENABLED',
  'SecurityConfiguration',
  'Moved production alert queue and delivery auditing into an append-only database trigger',
  jsonb_build_object('table', 'ProductionAlert', 'events', jsonb_build_array('QUEUED', 'SENT', 'FAILED')),
  now()
);
