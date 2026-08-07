CREATE UNIQUE INDEX notification_unique_supplier_opportunity_email
  ON bridge_ai."Notification" ("userId", type, channel, "actionUrl")
  WHERE channel = 'EMAIL' AND type = 'NEW_QUOTE_REQUEST';

-- The matching worker may queue an email only for an active member of the
-- supplier that currently holds the referenced assignment. User preferences
-- are enforced again in RLS so application code cannot bypass an opt-out.
CREATE POLICY whatsapp_ai_new_request_email_insert
  ON bridge_ai."Notification" FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
    AND type = 'NEW_QUOTE_REQUEST'
    AND channel = 'EMAIL'
    AND "supplierCompanyId" IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM bridge_ai.company_memberships membership
      WHERE membership."userId" = "Notification"."userId"
        AND membership."supplierCompanyId" = "Notification"."supplierCompanyId"
        AND membership.status = 'ACTIVE'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM bridge_ai."NotificationPreference" preference
      WHERE preference."userId" = "Notification"."userId"
        AND preference."supplierCompanyId" = "Notification"."supplierCompanyId"
        AND NOT preference."emailNewRequests"
    )
    AND EXISTS (
      SELECT 1
      FROM bridge_ai."SupplierAssignment" assignment
      JOIN bridge_ai."QuoteRequest" request ON request.id = assignment."quoteRequestId"
      WHERE assignment."supplierCompanyId" = "Notification"."supplierCompanyId"
        AND assignment.status IN ('PENDING', 'VIEWED', 'ACCEPTED')
        AND "Notification"."actionUrl" = '/dashboard/requests/' || request.reference
    )
  );

DROP POLICY IF EXISTS supplier_email_notification_select ON bridge_ai."Notification";
CREATE POLICY supplier_email_notification_select
  ON bridge_ai."Notification" FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('supplier_email'))
    AND type IN ('NEW_QUOTE_REQUEST', 'QUOTATION_ACCEPTED')
    AND channel = 'EMAIL'
  );

DROP POLICY IF EXISTS supplier_email_notification_update ON bridge_ai."Notification";
CREATE POLICY supplier_email_notification_update
  ON bridge_ai."Notification" FOR UPDATE TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('supplier_email'))
    AND type IN ('NEW_QUOTE_REQUEST', 'QUOTATION_ACCEPTED')
    AND channel = 'EMAIL'
  )
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('supplier_email'))
    AND type IN ('NEW_QUOTE_REQUEST', 'QUOTATION_ACCEPTED')
    AND channel = 'EMAIL'
  );

DROP POLICY IF EXISTS supplier_email_system_event_insert ON bridge_ai."SystemEvent";
CREATE POLICY supplier_email_system_event_insert
  ON bridge_ai."SystemEvent" FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('supplier_email'))
    AND source = 'RESEND'
    AND code = 'SUPPLIER_EMAIL_FAILED'
  );

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", summary, metadata, "createdAt"
)
VALUES (
  'system_supplier_opportunity_email_20260807190000',
  'SYSTEM.SUPPLIER_OPPORTUNITY_EMAIL_ENABLED',
  'SecurityConfiguration',
  'Enabled preference-aware supplier opportunity emails with assignment-bound RLS',
  jsonb_build_object(
    'worker', 'supplier_email',
    'notificationType', 'NEW_QUOTE_REQUEST',
    'maximumAttempts', 5,
    'customerPiiInEmail', false
  ),
  now()
);
