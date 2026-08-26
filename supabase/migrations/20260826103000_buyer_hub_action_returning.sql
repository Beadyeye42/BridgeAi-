-- Buyer Hub questions and selections are authorised by a verified buyer
-- session and then performed by the server-only WhatsApp worker. Prisma's
-- INSERT ... RETURNING requires the same worker to see the audit row it just
-- created; without SELECT visibility PostgreSQL rolls back the whole action.

DROP POLICY IF EXISTS buyer_auth_security_event_read
  ON bridge_ai."BuyerSecurityEvent";

CREATE POLICY buyer_auth_security_event_read
  ON bridge_ai."BuyerSecurityEvent"
  FOR SELECT
  TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('buyer_auth'))
    OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
    OR (SELECT bridge_private.is_platform_admin())
  );

COMMENT ON POLICY buyer_auth_security_event_read
  ON bridge_ai."BuyerSecurityEvent" IS
  'Server-only buyer_auth and whatsapp_ai INSERT RETURNING support plus platform administration.';
