-- Promotion selection and subscriber-limit checks run only inside the trusted
-- Stripe worker. Supplier browser identities cannot enumerate campaigns.
CREATE POLICY promotion_stripe_worker_select ON bridge_ai."MembershipPromotion"
  FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('stripe_billing')));

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", summary, metadata, "createdAt")
VALUES (
  'system_geographic_promotion_worker_read_20260807184500',
  'SYSTEM.GEOGRAPHIC_PROMOTION_WORKER_READ_ENABLED',
  'SecurityConfiguration',
  'Enabled narrowly scoped promotion reads for Stripe checkout and subscriber-limit enforcement',
  jsonb_build_object('worker', 'stripe_billing'),
  now()
);
