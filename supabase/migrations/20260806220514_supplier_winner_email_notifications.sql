ALTER TABLE bridge_ai."Notification"
  ADD COLUMN "deliveryAttempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN "availableAt" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN "lockedAt" timestamptz,
  ADD COLUMN "lastAttemptAt" timestamptz,
  ADD COLUMN "providerMessageId" text;

CREATE INDEX "Notification_channel_sentAt_availableAt_createdAt_idx"
  ON bridge_ai."Notification" (channel, "sentAt", "availableAt", "createdAt");

CREATE UNIQUE INDEX notification_unique_supplier_winner_email
  ON bridge_ai."Notification" ("userId", type, channel, "actionUrl")
  WHERE channel = 'EMAIL' AND type = 'QUOTATION_ACCEPTED';

-- Customer selection may queue only a winner email for an assigned supplier
-- team member. The separate email worker owns delivery state and cannot read
-- any customer records or WhatsApp message contents.
CREATE POLICY whatsapp_ai_winner_email_insert
  ON bridge_ai."Notification" FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
    AND type = 'QUOTATION_ACCEPTED'
    AND channel = 'EMAIL'
    AND "supplierCompanyId" IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM bridge_ai.company_memberships membership
      WHERE membership."userId" = "Notification"."userId"
        AND membership."supplierCompanyId" = "Notification"."supplierCompanyId"
        AND membership.status = 'ACTIVE'
    )
  );

CREATE POLICY supplier_email_notification_select
  ON bridge_ai."Notification" FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('supplier_email'))
    AND type = 'QUOTATION_ACCEPTED'
    AND channel = 'EMAIL'
  );

CREATE POLICY supplier_email_notification_update
  ON bridge_ai."Notification" FOR UPDATE TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('supplier_email'))
    AND type = 'QUOTATION_ACCEPTED'
    AND channel = 'EMAIL'
  )
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('supplier_email'))
    AND type = 'QUOTATION_ACCEPTED'
    AND channel = 'EMAIL'
  );

CREATE POLICY supplier_email_active_profile_select
  ON bridge_ai.portal_profiles FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('supplier_email'))
    AND status = 'ACTIVE'
  );

CREATE POLICY supplier_email_audit_insert
  ON bridge_ai."AuditLog" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('supplier_email')));

CREATE POLICY supplier_email_system_event_insert
  ON bridge_ai."SystemEvent" FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('supplier_email'))
    AND source = 'RESEND'
    AND code = 'SUPPLIER_WINNER_EMAIL_FAILED'
  );

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", summary, metadata, "createdAt"
)
VALUES (
  'system_supplier_winner_email_20260806215024',
  'SYSTEM.SUPPLIER_WINNER_EMAIL_ENABLED',
  'SecurityConfiguration',
  'Enabled idempotent supplier winner emails with retry-safe worker policies',
  jsonb_build_object('worker', 'supplier_email', 'maximumAttempts', 5, 'customerPiiInEmail', false),
  now()
);
