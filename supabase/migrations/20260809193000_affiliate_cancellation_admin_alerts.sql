-- Stripe owns the authoritative subscription lifecycle. Permit that narrowly
-- scoped worker to enqueue administrator cancellation alerts in the existing
-- durable monitoring outbox. Delivery remains handled by the monitored Resend
-- worker with retry and deduplication.
CREATE POLICY production_alert_stripe_affiliate_insert
  ON bridge_ai."ProductionAlert"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('stripe_billing'))
    AND source = 'AFFILIATE_LIFECYCLE'
    AND severity = 'WARNING'
    AND "actionUrl" LIKE '/admin/affiliates/%'
    AND fingerprint LIKE 'affiliate-cancellation-%'
  );

COMMENT ON POLICY production_alert_stripe_affiliate_insert
  ON bridge_ai."ProductionAlert" IS
  'Allows only the Stripe billing worker to enqueue deduplicated affiliate cancellation alerts for administrators.';

-- The administrator view always asks only for cancellation rows. Partial
-- indexes keep that audit query small while avoiding write overhead for the
-- much larger population of healthy referrals.
CREATE INDEX affiliate_referrals_recent_cancellation_idx
  ON bridge_ai.affiliate_referrals ("updatedAt" DESC, "affiliateId")
  WHERE "cancellationScheduledAt" IS NOT NULL OR "cancelledAt" IS NOT NULL;

CREATE INDEX affiliate_referrals_cancelled_idx
  ON bridge_ai.affiliate_referrals ("affiliateId", "cancelledAt" DESC)
  WHERE "cancelledAt" IS NOT NULL;

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", summary, metadata, "createdAt")
VALUES (
  'system_affiliate_cancellation_alerts_20260809193000',
  'SYSTEM.AFFILIATE_CANCELLATION_ALERTS_ENABLED',
  'SecurityConfiguration',
  'Enabled durable administrator alerts and indexed oversight for affiliate referral cancellations',
  jsonb_build_object('source', 'AFFILIATE_LIFECYCLE', 'delivery', 'production_alert_outbox'),
  now()
);
