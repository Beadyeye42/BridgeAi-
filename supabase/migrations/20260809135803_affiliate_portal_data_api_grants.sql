-- Table grants and RLS are separate controls. Give signed-in affiliates only
-- the minimum Data API privileges needed for their own realtime portal rows;
-- the owner-only RLS policies continue to isolate every affiliate.
GRANT SELECT ON TABLE
  bridge_ai.affiliate_programme,
  bridge_ai.affiliates,
  bridge_ai.affiliate_referrals,
  bridge_ai.referral_clicks,
  bridge_ai.affiliate_commissions,
  bridge_ai.affiliate_payouts,
  bridge_ai.affiliate_payout_items,
  bridge_ai.affiliate_notifications,
  bridge_ai.affiliate_audit_logs
TO authenticated;

GRANT UPDATE ("readAt") ON TABLE bridge_ai.affiliate_notifications TO authenticated;

REVOKE INSERT, DELETE ON TABLE
  bridge_ai.affiliate_programme,
  bridge_ai.affiliates,
  bridge_ai.affiliate_referrals,
  bridge_ai.referral_clicks,
  bridge_ai.affiliate_commissions,
  bridge_ai.affiliate_payouts,
  bridge_ai.affiliate_payout_items,
  bridge_ai.affiliate_notifications,
  bridge_ai.affiliate_audit_logs
FROM authenticated;

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", summary, metadata, "createdAt")
VALUES (
  'system_affiliate_portal_grants_20260809150500',
  'SYSTEM.AFFILIATE_PORTAL_DATA_API_GRANTS_ENABLED',
  'SecurityConfiguration',
  'Enabled owner-isolated affiliate portal reads and notification read-state updates',
  jsonb_build_object('financialAccess', 'read_only', 'notificationUpdateColumns', jsonb_build_array('readAt')),
  now()
);
