-- Apply the same device-grant boundary to direct Data API/Realtime reads as
-- getBuyerSession applies to server routes. JWT claims are installed by the
-- Supabase gateway, never accepted from buyer request bodies.
CREATE OR REPLACE FUNCTION bridge_private.is_current_buyer(target_customer_contact_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM bridge_ai."CustomerContact" customer
    JOIN bridge_ai."BuyerTrustedSession" trusted
      ON trusted."customerContactId" = customer.id
      AND trusted."authUserId" = customer."buyerAuthUserId"
    WHERE customer.id = target_customer_contact_id
      AND customer."buyerAuthUserId" = bridge_private.current_user_id()
      AND customer."buyerPortalStatus" = 'ACTIVE'
      AND trusted."sessionId"::text = (
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id'
      )
      AND trusted."revokedAt" IS NULL
      AND trusted."expiresAt" > now()
  );
$$;
REVOKE ALL ON FUNCTION bridge_private.is_current_buyer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bridge_private.is_current_buyer(text) TO authenticated, bridge_ai_app;

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", "entityId", summary, metadata, "createdAt")
VALUES (
  'system_buyer_trusted_session_rls_20260906215755',
  'SYSTEM.BUYER_TRUSTED_SESSION_RLS_ENABLED', 'SecurityPolicy', 'buyer-owned-data',
  'Buyer Data API and Realtime reads require an active session-bound device grant',
  '{"requiresTrustedSession":true,"rejectsRevokedSessions":true}'::jsonb, now()
);
