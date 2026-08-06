DROP POLICY stripe_billing_system_event_insert ON bridge_ai."SystemEvent";

CREATE POLICY stripe_billing_system_event_insert
  ON bridge_ai."SystemEvent" FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('stripe_billing'))
    AND source IN ('STRIPE_WEBHOOK', 'STRIPE_CHECKOUT')
  );

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", summary, metadata, "createdAt"
)
VALUES (
  'system_stripe_checkout_alerts_20260806195800',
  'SYSTEM.STRIPE_CHECKOUT_ALERTS_ENABLED',
  'SecurityConfiguration',
  'Enabled server-side system alerts for failed Stripe checkout creation',
  jsonb_build_object('worker', 'stripe_billing', 'source', 'STRIPE_CHECKOUT'),
  now()
);
