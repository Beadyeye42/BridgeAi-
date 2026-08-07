-- Prisma write operations use RETURNING. Forced RLS therefore needs narrowly
-- scoped SELECT policies for the rows created by the supplier email worker.
CREATE POLICY supplier_email_audit_select
  ON bridge_ai."AuditLog" FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('supplier_email'))
    AND action LIKE 'NOTIFICATION.SUPPLIER\_%' ESCAPE '\'
  );

CREATE POLICY supplier_email_system_event_select
  ON bridge_ai."SystemEvent" FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('supplier_email'))
    AND source = 'RESEND'
    AND code = 'SUPPLIER_EMAIL_FAILED'
  );

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", summary, metadata, "createdAt"
)
VALUES (
  'system_supplier_email_returning_20260807191500',
  'SYSTEM.SUPPLIER_EMAIL_RETURNING_POLICIES_ENABLED',
  'SecurityConfiguration',
  'Enabled narrowly scoped supplier email worker read-back policies required by database RETURNING',
  jsonb_build_object('worker', 'supplier_email'),
  now()
);
