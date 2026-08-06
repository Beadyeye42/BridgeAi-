-- Stripe checkout and verified webhooks run through a narrowly scoped server
-- worker context. Portal identities cannot activate this context because the
-- predicate also requires the dedicated bridge_ai_app database login.
CREATE POLICY stripe_billing_subscription_select
  ON bridge_ai."Subscription" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('stripe_billing')));

CREATE POLICY stripe_billing_subscription_insert
  ON bridge_ai."Subscription" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('stripe_billing')));

CREATE POLICY stripe_billing_subscription_update
  ON bridge_ai."Subscription" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('stripe_billing')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('stripe_billing')));

CREATE POLICY stripe_billing_webhook_event_select
  ON bridge_ai."WebhookEvent" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('stripe_billing')));

CREATE POLICY stripe_billing_webhook_event_insert
  ON bridge_ai."WebhookEvent" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('stripe_billing')));

CREATE POLICY stripe_billing_webhook_event_update
  ON bridge_ai."WebhookEvent" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('stripe_billing')))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('stripe_billing')));

CREATE POLICY stripe_billing_audit_insert
  ON bridge_ai."AuditLog" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('stripe_billing')));

CREATE POLICY stripe_billing_system_event_insert
  ON bridge_ai."SystemEvent" FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('stripe_billing'))
    AND source = 'STRIPE_WEBHOOK'
  );

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", summary, metadata, "createdAt"
)
VALUES (
  'system_stripe_billing_worker_rls_20260806195200',
  'SYSTEM.STRIPE_BILLING_WORKER_RLS_ENABLED',
  'SecurityConfiguration',
  'Enabled narrowly scoped RLS policies for Stripe checkout and verified webhook persistence',
  jsonb_build_object('worker', 'stripe_billing'),
  now()
);
