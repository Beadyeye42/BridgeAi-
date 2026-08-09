-- Production monitoring needs a narrowly scoped worker identity so forced RLS
-- remains effective while the alert outbox discovers, claims and records
-- operational failures. The worker cannot access customer contacts, messages,
-- quotations, subscriptions or any unrelated application rows.

CREATE POLICY production_monitoring_select_failed_whatsapp_jobs
  ON bridge_ai."WhatsAppJob"
  FOR SELECT
  TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('production_monitoring'))
    AND status = 'FAILED'
    AND ("errorCode" IS NULL OR "errorCode" NOT LIKE 'SUPERSEDED\_%' ESCAPE '\')
  );

CREATE POLICY production_monitoring_select_failed_stripe_webhooks
  ON bridge_ai."WebhookEvent"
  FOR SELECT
  TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('production_monitoring'))
    AND provider = 'STRIPE'
    AND "failedAt" IS NOT NULL
    AND "processedAt" IS NULL
  );

CREATE POLICY production_monitoring_select_problem_attachments
  ON bridge_ai."Attachment"
  FOR SELECT
  TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('production_monitoring'))
    AND "scanStatus" IN ('PENDING', 'FAILED', 'REJECTED')
  );

CREATE POLICY production_monitoring_select_storage_events
  ON bridge_ai."SystemEvent"
  FOR SELECT
  TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('production_monitoring'))
    AND status <> 'RESOLVED'
    AND severity IN ('ERROR', 'CRITICAL')
    AND (
      source IN ('storage', 'attachment')
      OR code LIKE '%UPLOAD_FAILED%'
      OR code LIKE '%ATTACHMENT%'
    )
  );

CREATE POLICY production_monitoring_select_alerts
  ON bridge_ai."ProductionAlert"
  FOR SELECT
  TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('production_monitoring')));

CREATE POLICY production_monitoring_insert_alerts
  ON bridge_ai."ProductionAlert"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('production_monitoring'))
    AND source IN ('WHATSAPP', 'STRIPE', 'ATTACHMENT')
    AND severity IN ('WARNING', 'ERROR', 'CRITICAL')
    AND (
      fingerprint LIKE 'whatsapp-job:%'
      OR fingerprint LIKE 'stripe-webhook:%'
      OR fingerprint LIKE 'attachment:%'
      OR fingerprint LIKE 'system-event:%'
    )
    AND "actionUrl" LIKE '%/admin/system'
  );

-- The delivery worker must also process cancellation alerts that the Stripe
-- worker places in this durable outbox, so update access covers existing alert
-- rows but grants no delete permission.
CREATE POLICY production_monitoring_update_alerts
  ON bridge_ai."ProductionAlert"
  FOR UPDATE
  TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('production_monitoring')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('production_monitoring')));

CREATE POLICY production_monitoring_insert_audit_logs
  ON bridge_ai."AuditLog"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('production_monitoring'))
    AND "actorUserId" IS NULL
    AND "entityType" = 'ProductionAlert'
    AND action IN (
      'MONITORING.ALERTS_QUEUED',
      'MONITORING.ALERTS_SENT',
      'MONITORING.ALERT_DELIVERY_FAILED'
    )
  );

COMMENT ON POLICY production_monitoring_select_failed_whatsapp_jobs
  ON bridge_ai."WhatsAppJob" IS
  'Allows only the production monitoring worker to discover genuine failed WhatsApp jobs.';
COMMENT ON POLICY production_monitoring_update_alerts
  ON bridge_ai."ProductionAlert" IS
  'Allows only the production monitoring worker to claim, retry and complete durable alert delivery.';

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", summary, metadata, "createdAt")
VALUES (
  'system_production_monitoring_worker_rls_20260809145934',
  'SYSTEM.PRODUCTION_MONITORING_WORKER_RLS_ENABLED',
  'SecurityConfiguration',
  'Enabled least-privilege database policies for production monitoring and alert delivery',
  jsonb_build_object('worker', 'production_monitoring', 'delete_access', false),
  now()
);
