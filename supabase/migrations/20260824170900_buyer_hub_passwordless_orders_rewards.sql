-- Buyer Hub foundation. Buyers continue to originate in WhatsApp; this adds a
-- short-lived passwordless login bridge into a real Supabase Auth session and
-- ownership-isolated order/reward records. Supplier identities remain absent
-- from buyer-readable database policies until a quotation has been selected.

CREATE TYPE bridge_ai."BuyerPortalStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE bridge_ai."BuyerOrderStatus" AS ENUM (
  'PENDING_CONFIRMATION', 'CONFIRMED', 'IN_PRODUCTION', 'READY',
  'DISPATCHED', 'OUT_FOR_DELIVERY', 'READY_FOR_COLLECTION', 'DELIVERED',
  'COMPLETED', 'CANCELLED', 'ISSUE_REPORTED'
);
CREATE TYPE bridge_ai."BuyerRewardTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');
CREATE TYPE bridge_ai."BuyerRewardEntryType" AS ENUM ('ORDER_COMPLETED', 'ADMIN_ADJUSTMENT', 'REVERSAL');

ALTER TABLE bridge_ai."CustomerContact"
  ADD COLUMN "buyerAuthUserId" uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN "buyerPortalStatus" bridge_ai."BuyerPortalStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "companyNameEncrypted" bytea,
  ADD COLUMN "defaultPostcodeEncrypted" bytea,
  ADD COLUMN "buyerTypePreference" bridge_ai."BuyerType",
  ADD COLUMN "verifiedEmailAt" timestamptz,
  ADD COLUMN "buyerWhatsAppUpdates" boolean NOT NULL DEFAULT true,
  ADD COLUMN "buyerEmailUpdates" boolean NOT NULL DEFAULT false,
  ADD COLUMN "buyerLastLoginAt" timestamptz;

CREATE INDEX "CustomerContact_buyerPortalStatus_buyerLastLoginAt_idx"
  ON bridge_ai."CustomerContact" ("buyerPortalStatus", "buyerLastLoginAt");

CREATE TABLE bridge_ai."BuyerLoginChallenge" (
  id text PRIMARY KEY,
  "customerContactId" text NOT NULL REFERENCES bridge_ai."CustomerContact"(id) ON DELETE CASCADE,
  "authUserId" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "tokenDigest" varchar(64) NOT NULL UNIQUE CHECK ("tokenDigest" ~ '^[a-f0-9]{64}$'),
  "requestedPath" varchar(512) NOT NULL DEFAULT '/buyer',
  "requestIpHash" varchar(64),
  "userAgentHash" varchar(64),
  "expiresAt" timestamptz NOT NULL,
  "consumedAt" timestamptz,
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '15 minutes'),
  CHECK ("consumedAt" IS NULL OR "consumedAt" >= "createdAt"),
  CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
);
CREATE INDEX "BuyerLoginChallenge_customerContactId_createdAt_idx" ON bridge_ai."BuyerLoginChallenge" ("customerContactId", "createdAt");
CREATE INDEX "BuyerLoginChallenge_requestIpHash_createdAt_idx" ON bridge_ai."BuyerLoginChallenge" ("requestIpHash", "createdAt");
CREATE INDEX "BuyerLoginChallenge_expiresAt_consumedAt_idx" ON bridge_ai."BuyerLoginChallenge" ("expiresAt", "consumedAt");

CREATE TABLE bridge_ai."BuyerTrustedSession" (
  id text PRIMARY KEY,
  "customerContactId" text NOT NULL REFERENCES bridge_ai."CustomerContact"(id) ON DELETE CASCADE,
  "authUserId" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "sessionId" uuid NOT NULL UNIQUE,
  "userAgentHash" varchar(64),
  "expiresAt" timestamptz NOT NULL,
  "lastSeenAt" timestamptz NOT NULL DEFAULT now(),
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '31 days'),
  CHECK ("lastSeenAt" >= "createdAt"),
  CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
);
CREATE INDEX "BuyerTrustedSession_customerContactId_expiresAt_idx" ON bridge_ai."BuyerTrustedSession" ("customerContactId", "expiresAt");
CREATE INDEX "BuyerTrustedSession_authUserId_revokedAt_expiresAt_idx" ON bridge_ai."BuyerTrustedSession" ("authUserId", "revokedAt", "expiresAt");

CREATE TABLE bridge_ai."BuyerSecurityEvent" (
  id text PRIMARY KEY,
  "customerContactId" text REFERENCES bridge_ai."CustomerContact"(id) ON DELETE SET NULL,
  "authUserId" uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  "eventType" varchar(64) NOT NULL,
  metadata jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "BuyerSecurityEvent_customerContactId_createdAt_idx" ON bridge_ai."BuyerSecurityEvent" ("customerContactId", "createdAt");
CREATE INDEX "BuyerSecurityEvent_authUserId_createdAt_idx" ON bridge_ai."BuyerSecurityEvent" ("authUserId", "createdAt");
CREATE INDEX "BuyerSecurityEvent_eventType_createdAt_idx" ON bridge_ai."BuyerSecurityEvent" ("eventType", "createdAt");

CREATE TABLE bridge_ai."BuyerOrder" (
  id text PRIMARY KEY,
  reference varchar(32) NOT NULL UNIQUE CHECK (reference ~ '^BO-[A-Z0-9]{8,24}$'),
  "customerContactId" text NOT NULL REFERENCES bridge_ai."CustomerContact"(id) ON DELETE RESTRICT,
  "quoteRequestId" text NOT NULL UNIQUE REFERENCES bridge_ai."QuoteRequest"(id) ON DELETE RESTRICT,
  "quotationId" text NOT NULL UNIQUE REFERENCES bridge_ai."SupplierQuotation"(id) ON DELETE RESTRICT,
  "supplierCompanyId" text NOT NULL REFERENCES bridge_ai.supplier_companies(id) ON DELETE RESTRICT,
  status bridge_ai."BuyerOrderStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "nextAction" text,
  "confirmedAt" timestamptz,
  "dispatchedAt" timestamptz,
  "deliveredAt" timestamptz,
  "completedAt" timestamptz,
  "cancelledAt" timestamptz,
  "issueReportedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "BuyerOrder_customerContactId_status_createdAt_idx" ON bridge_ai."BuyerOrder" ("customerContactId", status, "createdAt");
CREATE INDEX "BuyerOrder_supplierCompanyId_status_createdAt_idx" ON bridge_ai."BuyerOrder" ("supplierCompanyId", status, "createdAt");

CREATE TABLE bridge_ai."BuyerOrderEvent" (
  id text PRIMARY KEY,
  "buyerOrderId" text NOT NULL REFERENCES bridge_ai."BuyerOrder"(id) ON DELETE CASCADE,
  status bridge_ai."BuyerOrderStatus" NOT NULL,
  title text NOT NULL,
  detail text,
  source varchar(32) NOT NULL,
  "actorAuthUserId" uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "BuyerOrderEvent_buyerOrderId_createdAt_idx" ON bridge_ai."BuyerOrderEvent" ("buyerOrderId", "createdAt");

CREATE TABLE bridge_ai."BuyerRewardAccount" (
  "customerContactId" text PRIMARY KEY REFERENCES bridge_ai."CustomerContact"(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  "lifetimeEarned" integer NOT NULL DEFAULT 0 CHECK ("lifetimeEarned" >= 0),
  tier bridge_ai."BuyerRewardTier" NOT NULL DEFAULT 'BRONZE',
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "BuyerRewardAccount_tier_lifetimeEarned_idx" ON bridge_ai."BuyerRewardAccount" (tier, "lifetimeEarned");

CREATE TABLE bridge_ai."BuyerRewardLedger" (
  id text PRIMARY KEY,
  "customerContactId" text NOT NULL REFERENCES bridge_ai."CustomerContact"(id) ON DELETE RESTRICT,
  "buyerOrderId" text REFERENCES bridge_ai."BuyerOrder"(id) ON DELETE RESTRICT,
  "entryType" bridge_ai."BuyerRewardEntryType" NOT NULL,
  points integer NOT NULL CHECK (points <> 0),
  description text NOT NULL,
  "actorUserId" uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("buyerOrderId", "entryType")
);
CREATE INDEX "BuyerRewardLedger_customerContactId_createdAt_idx" ON bridge_ai."BuyerRewardLedger" ("customerContactId", "createdAt");
CREATE INDEX "BuyerRewardLedger_actorUserId_createdAt_idx" ON bridge_ai."BuyerRewardLedger" ("actorUserId", "createdAt");

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
    WHERE customer.id = target_customer_contact_id
      AND customer."buyerAuthUserId" = bridge_private.current_user_id()
      AND customer."buyerPortalStatus" = 'ACTIVE'
  );
$$;
REVOKE ALL ON FUNCTION bridge_private.is_current_buyer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bridge_private.is_current_buyer(text) TO authenticated, bridge_ai_app;

CREATE OR REPLACE FUNCTION bridge_private.enforce_buyer_login_challenge_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM bridge_ai."CustomerContact" customer
    WHERE customer.id = NEW."customerContactId"
      AND customer."buyerAuthUserId" = NEW."authUserId"
      AND customer."buyerPortalStatus" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'BUYER_LOGIN_SCOPE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER buyer_login_challenge_scope_guard
  BEFORE INSERT OR UPDATE OF "customerContactId", "authUserId"
  ON bridge_ai."BuyerLoginChallenge" FOR EACH ROW
  EXECUTE FUNCTION bridge_private.enforce_buyer_login_challenge_scope();

CREATE OR REPLACE FUNCTION bridge_private.enforce_buyer_trusted_session_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM bridge_ai."CustomerContact" customer
    WHERE customer.id = NEW."customerContactId"
      AND customer."buyerAuthUserId" = NEW."authUserId"
      AND customer."buyerPortalStatus" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'BUYER_TRUSTED_SESSION_SCOPE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER buyer_trusted_session_scope_guard
  BEFORE INSERT OR UPDATE OF "customerContactId", "authUserId"
  ON bridge_ai."BuyerTrustedSession" FOR EACH ROW
  EXECUTE FUNCTION bridge_private.enforce_buyer_trusted_session_scope();

CREATE OR REPLACE FUNCTION bridge_private.enforce_buyer_order_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM bridge_ai."QuoteRequest" request
    JOIN bridge_ai."SupplierQuotation" quotation
      ON quotation.id = NEW."quotationId"
     AND quotation."quoteRequestId" = request.id
    WHERE request.id = NEW."quoteRequestId"
      AND request."customerContactId" = NEW."customerContactId"
      AND quotation."supplierCompanyId" = NEW."supplierCompanyId"
      AND quotation.status = 'ACCEPTED'
  ) THEN
    RAISE EXCEPTION 'BUYER_ORDER_SCOPE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER buyer_order_scope_guard
  BEFORE INSERT OR UPDATE OF "customerContactId", "quoteRequestId", "quotationId", "supplierCompanyId"
  ON bridge_ai."BuyerOrder" FOR EACH ROW
  EXECUTE FUNCTION bridge_private.enforce_buyer_order_scope();

-- Preserve the existing live history. One accepted quotation is selected per
-- request, and deterministic references keep this backfill idempotent if the
-- migration is rehearsed against a restored production snapshot.
WITH accepted AS (
  SELECT DISTINCT ON (quotation."quoteRequestId")
    quotation.id AS quotation_id,
    quotation."quoteRequestId" AS request_id,
    quotation."supplierCompanyId" AS supplier_company_id,
    request."customerContactId" AS customer_contact_id,
    request.status AS request_status,
    request."confirmedAt" AS confirmed_at,
    request."completedAt" AS completed_at,
    request."cancelledAfterSelectionAt" AS cancelled_at,
    COALESCE(request."selectedAt", quotation."decidedAt", quotation."submittedAt", request."createdAt") AS selected_at
  FROM bridge_ai."SupplierQuotation" quotation
  JOIN bridge_ai."QuoteRequest" request ON request.id = quotation."quoteRequestId"
  WHERE quotation.status = 'ACCEPTED'
    AND request.status IN ('SELECTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED_AFTER_SELECTION', 'WON')
  ORDER BY quotation."quoteRequestId", quotation."decidedAt" DESC NULLS LAST, quotation.id
)
INSERT INTO bridge_ai."BuyerOrder" (
  id, reference, "customerContactId", "quoteRequestId", "quotationId",
  "supplierCompanyId", status, "confirmedAt", "completedAt", "cancelledAt",
  "createdAt", "updatedAt"
)
SELECT
  'buyer_order_' || replace(gen_random_uuid()::text, '-', ''),
  'BO-' || upper(substr(md5(accepted.request_id), 1, 16)),
  accepted.customer_contact_id,
  accepted.request_id,
  accepted.quotation_id,
  accepted.supplier_company_id,
  CASE
    WHEN accepted.request_status = 'CONFIRMED' THEN 'CONFIRMED'::bridge_ai."BuyerOrderStatus"
    WHEN accepted.request_status = 'COMPLETED' THEN 'COMPLETED'::bridge_ai."BuyerOrderStatus"
    WHEN accepted.request_status = 'CANCELLED_AFTER_SELECTION' THEN 'CANCELLED'::bridge_ai."BuyerOrderStatus"
    ELSE 'PENDING_CONFIRMATION'::bridge_ai."BuyerOrderStatus"
  END,
  accepted.confirmed_at,
  accepted.completed_at,
  accepted.cancelled_at,
  accepted.selected_at,
  GREATEST(
    accepted.selected_at,
    COALESCE(accepted.confirmed_at, accepted.selected_at),
    COALESCE(accepted.completed_at, accepted.selected_at),
    COALESCE(accepted.cancelled_at, accepted.selected_at)
  )
FROM accepted
ON CONFLICT DO NOTHING;

INSERT INTO bridge_ai."BuyerOrderEvent" (
  id, "buyerOrderId", status, title, detail, source, "createdAt"
)
SELECT
  'buyer_order_event_' || replace(gen_random_uuid()::text, '-', ''),
  orders.id,
  orders.status,
  CASE
    WHEN orders.status = 'CONFIRMED' THEN 'Existing order confirmed'
    WHEN orders.status = 'COMPLETED' THEN 'Existing order completed'
    WHEN orders.status = 'CANCELLED' THEN 'Existing order cancelled'
    ELSE 'Existing quote selected'
  END,
  'Imported from the existing Bridge-iT quote lifecycle',
  'MIGRATION',
  orders."createdAt"
FROM bridge_ai."BuyerOrder" orders
WHERE NOT EXISTS (
  SELECT 1 FROM bridge_ai."BuyerOrderEvent" events
  WHERE events."buyerOrderId" = orders.id
);

CREATE OR REPLACE FUNCTION bridge_private.prevent_reward_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'BUYER_REWARD_LEDGER_IS_IMMUTABLE' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER buyer_reward_ledger_immutable
  BEFORE UPDATE OR DELETE ON bridge_ai."BuyerRewardLedger"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.prevent_reward_ledger_mutation();

CREATE OR REPLACE FUNCTION bridge_private.credit_completed_buyer_order(
  target_order_id text,
  completion_points integer DEFAULT 100
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_customer_id text;
  target_company_id text;
  current_balance integer;
  lifetime_points integer;
BEGIN
  IF completion_points < 1 OR completion_points > 1000 THEN
    RAISE EXCEPTION 'INVALID_COMPLETION_POINTS' USING ERRCODE = '22023';
  END IF;

  SELECT orders."customerContactId", orders."supplierCompanyId"
    INTO target_customer_id, target_company_id
  FROM bridge_ai."BuyerOrder" orders
  WHERE orders.id = target_order_id AND orders.status = 'COMPLETED'
  FOR UPDATE;

  IF target_customer_id IS NULL THEN
    RAISE EXCEPTION 'COMPLETED_BUYER_ORDER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF NOT bridge_private.is_platform_admin()
     AND NOT bridge_private.has_company_membership(target_company_id)
     AND NOT bridge_private.is_trusted_worker('buyer_auth') THEN
    RAISE EXCEPTION 'BUYER_REWARD_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO bridge_ai."BuyerRewardLedger" (
    id, "customerContactId", "buyerOrderId", "entryType", points,
    description, "actorUserId", "createdAt"
  ) VALUES (
    gen_random_uuid()::text, target_customer_id, target_order_id,
    'ORDER_COMPLETED', completion_points,
    'Points earned for a completed Bridge-iT order',
    bridge_private.current_user_id(), now()
  ) ON CONFLICT ("buyerOrderId", "entryType") DO NOTHING;

  SELECT
    GREATEST(COALESCE(SUM(ledger.points), 0), 0),
    COALESCE(SUM(CASE WHEN ledger.points > 0 THEN ledger.points ELSE 0 END), 0)
    INTO current_balance, lifetime_points
  FROM bridge_ai."BuyerRewardLedger" ledger
  WHERE ledger."customerContactId" = target_customer_id;

  INSERT INTO bridge_ai."BuyerRewardAccount" (
    "customerContactId", balance, "lifetimeEarned", tier, "updatedAt"
  ) VALUES (
    target_customer_id,
    current_balance,
    lifetime_points,
    CASE
      WHEN lifetime_points >= 2500 THEN 'PLATINUM'::bridge_ai."BuyerRewardTier"
      WHEN lifetime_points >= 1000 THEN 'GOLD'::bridge_ai."BuyerRewardTier"
      WHEN lifetime_points >= 250 THEN 'SILVER'::bridge_ai."BuyerRewardTier"
      ELSE 'BRONZE'::bridge_ai."BuyerRewardTier"
    END,
    now()
  ) ON CONFLICT ("customerContactId") DO UPDATE SET
    balance = EXCLUDED.balance,
    "lifetimeEarned" = EXCLUDED."lifetimeEarned",
    tier = EXCLUDED.tier,
    "updatedAt" = now();
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.credit_completed_buyer_order(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bridge_private.credit_completed_buyer_order(text, integer) TO authenticated, bridge_ai_app;

ALTER TABLE bridge_ai."BuyerLoginChallenge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."BuyerLoginChallenge" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."BuyerTrustedSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."BuyerTrustedSession" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."BuyerSecurityEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."BuyerSecurityEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."BuyerOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."BuyerOrder" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."BuyerOrderEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."BuyerOrderEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."BuyerRewardAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."BuyerRewardAccount" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."BuyerRewardLedger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."BuyerRewardLedger" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON bridge_ai."BuyerLoginChallenge", bridge_ai."BuyerTrustedSession", bridge_ai."BuyerSecurityEvent",
  bridge_ai."BuyerOrder", bridge_ai."BuyerOrderEvent", bridge_ai."BuyerRewardAccount",
  bridge_ai."BuyerRewardLedger" FROM PUBLIC, anon;

GRANT SELECT ON bridge_ai."BuyerOrder", bridge_ai."BuyerOrderEvent",
  bridge_ai."BuyerRewardAccount", bridge_ai."BuyerRewardLedger" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bridge_ai."BuyerLoginChallenge" TO bridge_ai_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bridge_ai."BuyerTrustedSession" TO bridge_ai_app;
GRANT SELECT, INSERT ON bridge_ai."BuyerSecurityEvent" TO bridge_ai_app;
GRANT SELECT, INSERT, UPDATE ON bridge_ai."BuyerOrder", bridge_ai."BuyerOrderEvent",
  bridge_ai."BuyerRewardAccount" TO bridge_ai_app;
GRANT SELECT, INSERT ON bridge_ai."BuyerRewardLedger" TO bridge_ai_app;
GRANT SELECT, UPDATE ("buyerAuthUserId", "buyerLastLoginAt", "buyerPortalStatus",
  "companyNameEncrypted", "defaultPostcodeEncrypted", "buyerTypePreference",
  "verifiedEmailAt", "buyerWhatsAppUpdates", "buyerEmailUpdates")
  ON bridge_ai."CustomerContact" TO bridge_ai_app;

CREATE POLICY buyer_auth_challenge_all ON bridge_ai."BuyerLoginChallenge" FOR ALL TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_platform_admin()))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_platform_admin()));
CREATE POLICY buyer_auth_trusted_session_all ON bridge_ai."BuyerTrustedSession" FOR ALL TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_platform_admin()))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_platform_admin()));
CREATE POLICY buyer_auth_security_event_read ON bridge_ai."BuyerSecurityEvent" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_platform_admin()));
CREATE POLICY buyer_auth_security_event_insert ON bridge_ai."BuyerSecurityEvent" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')) OR (SELECT bridge_private.is_platform_admin()));
CREATE POLICY buyer_auth_customer_read ON bridge_ai."CustomerContact" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_platform_admin()));
CREATE POLICY buyer_auth_customer_update ON bridge_ai."CustomerContact" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_platform_admin()))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_platform_admin()));

CREATE POLICY buyer_order_owner_read ON bridge_ai."BuyerOrder" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_current_buyer("customerContactId")) OR (SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('buyer_auth')));
CREATE POLICY buyer_order_worker_insert ON bridge_ai."BuyerOrder" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')) OR (SELECT bridge_private.is_platform_admin()));
CREATE POLICY buyer_order_worker_update ON bridge_ai."BuyerOrder" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')) OR (SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.has_company_membership("supplierCompanyId")))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')) OR (SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.has_company_membership("supplierCompanyId")));

CREATE POLICY buyer_order_event_owner_read ON bridge_ai."BuyerOrderEvent" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('buyer_auth')) OR EXISTS (
    SELECT 1 FROM bridge_ai."BuyerOrder" orders
    WHERE orders.id = "buyerOrderId" AND (SELECT bridge_private.is_current_buyer(orders."customerContactId"))
  ));
CREATE POLICY buyer_order_event_worker_insert ON bridge_ai."BuyerOrderEvent" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')) OR (SELECT bridge_private.is_platform_admin()) OR EXISTS (
    SELECT 1 FROM bridge_ai."BuyerOrder" orders
    WHERE orders.id = "buyerOrderId" AND (SELECT bridge_private.has_company_membership(orders."supplierCompanyId"))
  ));

CREATE POLICY buyer_reward_account_owner_read ON bridge_ai."BuyerRewardAccount" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_current_buyer("customerContactId")) OR (SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('buyer_auth')));
CREATE POLICY buyer_reward_account_worker_write ON bridge_ai."BuyerRewardAccount" FOR ALL TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_platform_admin()))
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_platform_admin()));
CREATE POLICY buyer_reward_ledger_owner_read ON bridge_ai."BuyerRewardLedger" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_current_buyer("customerContactId")) OR (SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('buyer_auth')));
CREATE POLICY buyer_reward_ledger_worker_insert ON bridge_ai."BuyerRewardLedger" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('buyer_auth')) OR (SELECT bridge_private.is_platform_admin()));

-- Buyers may read only requests they own. SupplierQuotation intentionally gets
-- no buyer policy: comparisons are projected by the server without supplier IDs.
CREATE POLICY buyer_owned_request_read ON bridge_ai."QuoteRequest" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_current_buyer("customerContactId")));
CREATE POLICY buyer_owned_request_item_read ON bridge_ai."QuoteRequestItem" FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM bridge_ai."QuoteRequest" request
    WHERE request.id = "quoteRequestId" AND (SELECT bridge_private.is_current_buyer(request."customerContactId"))
  ));
CREATE POLICY buyer_owned_attachment_read ON bridge_ai."Attachment" FOR SELECT TO authenticated
  USING ("quoteRequestId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM bridge_ai."QuoteRequest" request
    WHERE request.id = "quoteRequestId" AND (SELECT bridge_private.is_current_buyer(request."customerContactId"))
  ));

-- buyer_auth is a server-only worker used after a verified Buyer Hub session
-- has been resolved. Application queries still include customerContactId in
-- every predicate; these policies allow the joined anonymous projection to be
-- assembled without ever exposing raw supplier rows to the browser.
CREATE POLICY buyer_auth_request_read ON bridge_ai."QuoteRequest" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('buyer_auth')));
CREATE POLICY buyer_auth_request_item_read ON bridge_ai."QuoteRequestItem" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('buyer_auth')));
CREATE POLICY buyer_auth_attachment_read ON bridge_ai."Attachment" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('buyer_auth')));
CREATE POLICY buyer_auth_quotation_read ON bridge_ai."SupplierQuotation" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('buyer_auth')));
CREATE POLICY buyer_auth_quote_conversation_read ON bridge_ai."QuoteConversation" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('buyer_auth')));
CREATE POLICY buyer_auth_quote_message_read ON bridge_ai."QuoteMessage" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('buyer_auth')));
CREATE POLICY buyer_auth_supplier_after_selection_read ON bridge_ai.supplier_companies FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('buyer_auth'))
    AND EXISTS (
      SELECT 1 FROM bridge_ai."BuyerOrder" orders
      WHERE orders."supplierCompanyId" = supplier_companies.id
    )
  );

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE bridge_ai."BuyerOrder";
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE bridge_ai."BuyerOrderEvent";
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE bridge_ai."BuyerRewardAccount";
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE bridge_ai."BuyerRewardLedger";
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'system_buyer_hub_security_20260824170900',
  'SYSTEM.BUYER_HUB_SECURITY_ENABLED',
  'SecurityConfiguration',
  'buyer-hub',
  'Enabled passwordless Buyer Hub access, anonymous quote comparison, order lifecycle and immutable rewards accounting',
  jsonb_build_object(
    'passwordlessWhatsApp', true,
    'challengeMinutes', 10,
    'trustedDeviceDays', 30,
    'anonymousQuoteLimit', 5,
    'realtimeOrders', true,
    'rewardsLedgerImmutable', true,
    'rlsForced', true
  ),
  now()
) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE bridge_ai."BuyerLoginChallenge" IS 'Hashed, ten-minute, single-use bridge from WhatsApp into a Supabase Auth session. Raw link secrets are never stored.';
COMMENT ON TABLE bridge_ai."BuyerTrustedSession" IS 'Thirty-day trusted-device grant bound to the exact verified Supabase session_id; revocable independently per device.';
COMMENT ON TABLE bridge_ai."BuyerOrder" IS 'Buyer-facing order lifecycle created only after authoritative quote selection.';
COMMENT ON TABLE bridge_ai."BuyerRewardLedger" IS 'Immutable per-event reward accounting; balances are derived from ledger entries, never guessed from current order counts.';
