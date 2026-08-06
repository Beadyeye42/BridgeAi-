-- Prisma's create/upsert operations use INSERT ... RETURNING. Forced RLS
-- therefore needs a matching SELECT policy as well as the write policy.
-- Keep the read-back access limited to the trusted Stripe worker and to
-- billing-owned rows only.
CREATE POLICY stripe_billing_audit_select
  ON bridge_ai."AuditLog" FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('stripe_billing'))
    AND action LIKE 'BILLING.%'
  );

CREATE POLICY stripe_billing_system_event_select
  ON bridge_ai."SystemEvent" FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('stripe_billing'))
    AND source IN ('STRIPE_WEBHOOK', 'STRIPE_CHECKOUT')
  );

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", summary, metadata, "createdAt"
)
VALUES (
  'system_stripe_worker_returning_20260806201500',
  'SYSTEM.STRIPE_WORKER_RETURNING_POLICIES_ENABLED',
  'SecurityConfiguration',
  'Enabled narrowly scoped Stripe worker read-back policies required by INSERT RETURNING',
  jsonb_build_object('worker', 'stripe_billing'),
  now()
);
