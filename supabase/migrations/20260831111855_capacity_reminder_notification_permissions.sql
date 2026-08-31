-- The trusted matching worker needs only these two in-app reminder paths.
-- SELECT is required both for INSERT RETURNING and unread-reminder deduplication.
-- No public caller, email worker, inactive membership or unrelated notification
-- gains access. Keep RLS enabled and forced.
CREATE POLICY whatsapp_ai_capacity_reminder_select
ON bridge_ai."Notification" FOR SELECT TO authenticated
USING (
  (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
  AND type = 'ACCOUNT_UPDATE' AND channel = 'IN_APP'
  AND "actionUrl" IN ('/dashboard/capabilities', '/dashboard/capabilities?attention=monthly-capacity')
  AND EXISTS (
    SELECT 1 FROM bridge_ai.company_memberships m
    WHERE m."userId" = "Notification"."userId"
      AND m."supplierCompanyId" = "Notification"."supplierCompanyId"
      AND m.status = 'ACTIVE'
  )
);

CREATE POLICY whatsapp_ai_capacity_reminder_insert
ON bridge_ai."Notification" FOR INSERT TO authenticated
WITH CHECK (
  (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
  AND type = 'ACCOUNT_UPDATE' AND channel = 'IN_APP'
  AND "actionUrl" IN ('/dashboard/capabilities', '/dashboard/capabilities?attention=monthly-capacity')
  AND EXISTS (
    SELECT 1 FROM bridge_ai.company_memberships m
    JOIN bridge_ai.supplier_companies c ON c.id = m."supplierCompanyId"
    JOIN bridge_ai."Subscription" s ON s."supplierCompanyId" = c.id
    WHERE m."userId" = "Notification"."userId"
      AND m."supplierCompanyId" = "Notification"."supplierCompanyId"
      AND m.status = 'ACTIVE' AND c.status = 'APPROVED'
      AND s.status = 'ACTIVE'
      AND (s."currentPeriodEnd" IS NULL OR s."currentPeriodEnd" > now())
  )
);

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", "entityId", summary, metadata, "createdAt")
VALUES ('migration_capacity_reminder_permissions_20260831', 'SYSTEM.CAPACITY_REMINDER_PERMISSIONS_UPDATED',
  'System', 'capacity_reminders', 'Enabled narrowly scoped in-app capacity reminders for the trusted matching worker',
  '{"channels":["IN_APP"],"notificationType":"ACCOUNT_UPDATE","publicAccess":false}'::jsonb, now());
