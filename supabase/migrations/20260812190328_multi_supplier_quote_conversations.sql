-- Private, anonymous buyer-to-supplier quote conversations. Customer text is
-- encrypted by the application before it reaches these tables. Suppliers can
-- only read the conversation attached to their own company quotation.

CREATE TYPE bridge_ai."QuoteConversationStatus" AS ENUM ('OPEN', 'SELECTED', 'CLOSED', 'EXPIRED');
CREATE TYPE bridge_ai."QuoteMessageSender" AS ENUM ('BUYER', 'SUPPLIER', 'SYSTEM');
CREATE TYPE bridge_ai."QuoteMessageStatus" AS ENUM ('PENDING', 'DELIVERED', 'BLOCKED', 'FAILED');
ALTER TABLE bridge_ai."SupplierQuotation"
  ADD COLUMN IF NOT EXISTS specification text,
  ADD COLUMN IF NOT EXISTS "deliveryCost" numeric(12,2),
  ADD COLUMN IF NOT EXISTS "collectionAvailable" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS availability text,
  ADD COLUMN IF NOT EXISTS warranty text,
  ADD COLUMN IF NOT EXISTS "paymentTerms" text,
  ADD COLUMN IF NOT EXISTS assumptions text,
  ADD COLUMN IF NOT EXISTS exclusions text,
  ADD COLUMN IF NOT EXISTS "vatIncluded" boolean,
  ADD COLUMN IF NOT EXISTS "currentVersionNumber" integer NOT NULL DEFAULT 0;

CREATE TABLE bridge_ai."QuotationVersion" (
  id text PRIMARY KEY,
  "quotationId" text NOT NULL REFERENCES bridge_ai."SupplierQuotation"(id) ON DELETE CASCADE,
  "versionNumber" integer NOT NULL CHECK ("versionNumber" > 0),
  price numeric(12,2) NOT NULL CHECK (price > 0),
  currency varchar(3) NOT NULL DEFAULT 'GBP',
  "leadTimeDays" integer NOT NULL CHECK ("leadTimeDays" BETWEEN 1 AND 730),
  "validUntil" timestamptz,
  notes text,
  specification text,
  "deliveryCost" numeric(12,2) CHECK ("deliveryCost" IS NULL OR "deliveryCost" >= 0),
  "collectionAvailable" boolean NOT NULL DEFAULT false,
  availability text,
  warranty text,
  "paymentTerms" text,
  assumptions text,
  exclusions text,
  "vatIncluded" boolean,
  "submittedById" uuid NOT NULL REFERENCES bridge_ai.portal_profiles(id) ON DELETE RESTRICT,
  "submittedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("quotationId", "versionNumber")
);
CREATE INDEX "QuotationVersion_quotationId_submittedAt_idx" ON bridge_ai."QuotationVersion" ("quotationId", "submittedAt");

CREATE TABLE bridge_ai."QuoteConversation" (
  id text PRIMARY KEY,
  "quoteRequestId" text NOT NULL REFERENCES bridge_ai."QuoteRequest"(id) ON DELETE CASCADE,
  "quotationId" text NOT NULL UNIQUE REFERENCES bridge_ai."SupplierQuotation"(id) ON DELETE CASCADE,
  "supplierCompanyId" text NOT NULL REFERENCES bridge_ai.supplier_companies(id) ON DELETE CASCADE,
  "anonymousLabel" varchar(1) NOT NULL CHECK ("anonymousLabel" IN ('A','B','C','D','E')),
  status bridge_ai."QuoteConversationStatus" NOT NULL DEFAULT 'OPEN',
  "questionResponseDueAt" timestamptz,
  "lastMessageAt" timestamptz,
  "closedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("quoteRequestId", "anonymousLabel")
);
CREATE INDEX "QuoteConversation_supplierCompanyId_status_lastMessageAt_idx" ON bridge_ai."QuoteConversation" ("supplierCompanyId", status, "lastMessageAt");
CREATE INDEX "QuoteConversation_quoteRequestId_status_idx" ON bridge_ai."QuoteConversation" ("quoteRequestId", status);

CREATE TABLE bridge_ai."QuoteMessage" (
  id text PRIMARY KEY,
  "quoteConversationId" text NOT NULL REFERENCES bridge_ai."QuoteConversation"(id) ON DELETE CASCADE,
  sender bridge_ai."QuoteMessageSender" NOT NULL,
  "senderUserId" uuid REFERENCES bridge_ai.portal_profiles(id) ON DELETE SET NULL,
  "contentEncrypted" bytea NOT NULL CHECK (octet_length("contentEncrypted") > 30),
  status bridge_ai."QuoteMessageStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" text NOT NULL UNIQUE,
  "broadcastKey" uuid,
  "replyToId" text REFERENCES bridge_ai."QuoteMessage"(id) ON DELETE SET NULL,
  "questionDueAt" timestamptz,
  "answeredAt" timestamptz,
  "deliveredAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "QuoteMessage_quoteConversationId_createdAt_idx" ON bridge_ai."QuoteMessage" ("quoteConversationId", "createdAt");
CREATE INDEX "QuoteMessage_broadcastKey_idx" ON bridge_ai."QuoteMessage" ("broadcastKey");
CREATE INDEX "QuoteMessage_status_questionDueAt_idx" ON bridge_ai."QuoteMessage" (status, "questionDueAt");
CREATE UNIQUE INDEX "QuoteMessage_one_supplier_reply_per_question_key"
  ON bridge_ai."QuoteMessage" ("replyToId") WHERE sender = 'SUPPLIER' AND "replyToId" IS NOT NULL;

ALTER TABLE bridge_ai."WhatsAppJob"
  ADD COLUMN IF NOT EXISTS "quoteMessageId" text REFERENCES bridge_ai."QuoteMessage"(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "WhatsAppJob_quoteMessageId_idx" ON bridge_ai."WhatsAppJob" ("quoteMessageId");

CREATE TABLE bridge_ai."QuoteMessageModerationEvent" (
  id text PRIMARY KEY,
  "quoteConversationId" text NOT NULL REFERENCES bridge_ai."QuoteConversation"(id) ON DELETE CASCADE,
  "quoteMessageId" text REFERENCES bridge_ai."QuoteMessage"(id) ON DELETE SET NULL,
  "actorUserId" uuid REFERENCES bridge_ai.portal_profiles(id) ON DELETE SET NULL,
  outcome varchar(32) NOT NULL CHECK (outcome IN ('ALLOWED','BLOCKED','REDACTED')),
  reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "QuoteMessageModerationEvent_conversation_created_idx" ON bridge_ai."QuoteMessageModerationEvent" ("quoteConversationId", "createdAt");
CREATE INDEX "QuoteMessageModerationEvent_outcome_created_idx" ON bridge_ai."QuoteMessageModerationEvent" (outcome, "createdAt");

CREATE TABLE bridge_ai."QuoteSelectionEvent" (
  id text PRIMARY KEY,
  "quoteRequestId" text NOT NULL REFERENCES bridge_ai."QuoteRequest"(id) ON DELETE CASCADE,
  "quotationId" text REFERENCES bridge_ai."SupplierQuotation"(id) ON DELETE SET NULL,
  "eventType" varchar(40) NOT NULL,
  evidence varchar(250),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "QuoteSelectionEvent_request_created_idx" ON bridge_ai."QuoteSelectionEvent" ("quoteRequestId", "createdAt");
CREATE INDEX "QuoteSelectionEvent_quotation_created_idx" ON bridge_ai."QuoteSelectionEvent" ("quotationId", "createdAt");

CREATE OR REPLACE FUNCTION bridge_private.enforce_quote_conversation_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q bridge_ai."SupplierQuotation"%ROWTYPE;
BEGIN
  SELECT * INTO q FROM bridge_ai."SupplierQuotation" WHERE id = NEW."quotationId";
  IF NOT FOUND OR q."quoteRequestId" <> NEW."quoteRequestId" OR q."supplierCompanyId" <> NEW."supplierCompanyId" THEN
    RAISE EXCEPTION 'QUOTE_CONVERSATION_SCOPE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quote_conversation_scope_guard
  BEFORE INSERT OR UPDATE OF "quoteRequestId", "quotationId", "supplierCompanyId"
  ON bridge_ai."QuoteConversation" FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_quote_conversation_scope();

CREATE OR REPLACE FUNCTION bridge_private.enforce_quote_message_reply_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW."replyToId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bridge_ai."QuoteMessage" parent
    WHERE parent.id = NEW."replyToId" AND parent."quoteConversationId" = NEW."quoteConversationId"
  ) THEN RAISE EXCEPTION 'QUOTE_MESSAGE_REPLY_SCOPE_MISMATCH' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quote_message_reply_scope_guard
  BEFORE INSERT OR UPDATE OF "quoteConversationId", "replyToId"
  ON bridge_ai."QuoteMessage" FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_quote_message_reply_scope();

-- The assignment expiry is an acknowledgement deadline. Once a supplier has
-- already quoted, revisions remain valid until the request response deadline.
CREATE OR REPLACE FUNCTION bridge_private.enforce_open_request_for_quotation_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_status bridge_ai."QuoteRequestStatus";
  response_due_at timestamptz;
  assignment_status bridge_ai."AssignmentStatus";
  assignment_expires_at timestamptz;
BEGIN
  IF NEW.status <> 'SUBMITTED' THEN
    RETURN NEW;
  END IF;

  IF NOT bridge_private.has_active_supplier_subscription(NEW."supplierCompanyId") THEN
    RAISE EXCEPTION 'ACTIVE_MEMBERSHIP_REQUIRED' USING ERRCODE = '23514';
  END IF;

  SELECT request.status, request."responseDueAt", assignment.status, assignment."expiresAt"
  INTO request_status, response_due_at, assignment_status, assignment_expires_at
  FROM bridge_ai."QuoteRequest" request
  JOIN bridge_ai."SupplierAssignment" assignment
    ON assignment.id = NEW."assignmentId"
   AND assignment."quoteRequestId" = NEW."quoteRequestId"
   AND assignment."supplierCompanyId" = NEW."supplierCompanyId"
  WHERE request.id = NEW."quoteRequestId"
  FOR SHARE OF request, assignment;

  IF request_status IS NULL THEN
    RAISE EXCEPTION 'QUOTATION_ASSIGNMENT_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
  IF assignment_status NOT IN ('ACCEPTED', 'QUOTED')
     OR (assignment_status = 'ACCEPTED' AND (assignment_expires_at IS NULL OR assignment_expires_at <= now())) THEN
    RAISE EXCEPTION 'ASSIGNMENT_CLOSED' USING ERRCODE = '23514';
  END IF;
  IF request_status NOT IN ('OPEN', 'MATCHING', 'QUOTED')
     OR response_due_at IS NULL
     OR response_due_at <= now() THEN
    RAISE EXCEPTION 'QUOTE_REQUEST_CLOSED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_open_request_for_quotation_submission()
  FROM PUBLIC, anon, authenticated, service_role, bridge_ai_app;

ALTER TABLE bridge_ai."QuotationVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."QuotationVersion" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."QuoteConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."QuoteConversation" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."QuoteMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."QuoteMessage" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."QuoteMessageModerationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."QuoteMessageModerationEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."QuoteSelectionEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."QuoteSelectionEvent" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON bridge_ai."QuotationVersion", bridge_ai."QuoteConversation", bridge_ai."QuoteMessage", bridge_ai."QuoteMessageModerationEvent", bridge_ai."QuoteSelectionEvent" FROM PUBLIC, anon;
GRANT SELECT, INSERT ON bridge_ai."QuotationVersion", bridge_ai."QuoteConversation", bridge_ai."QuoteMessage", bridge_ai."QuoteMessageModerationEvent", bridge_ai."QuoteSelectionEvent" TO authenticated, bridge_ai_app;
GRANT UPDATE ("lastMessageAt") ON bridge_ai."QuoteConversation" TO authenticated;
GRANT UPDATE ON bridge_ai."QuoteConversation", bridge_ai."QuoteMessage" TO bridge_ai_app;

CREATE POLICY quote_version_company_read ON bridge_ai."QuotationVersion" FOR SELECT TO authenticated
USING ((SELECT bridge_private.is_platform_admin()) OR EXISTS (
  SELECT 1 FROM bridge_ai."SupplierQuotation" q
  WHERE q.id = "quotationId" AND (SELECT bridge_private.has_company_membership(q."supplierCompanyId"))
));
CREATE POLICY quote_version_company_insert ON bridge_ai."QuotationVersion" FOR INSERT TO authenticated
WITH CHECK ((SELECT bridge_private.is_platform_admin()) OR EXISTS (
  SELECT 1 FROM bridge_ai."SupplierQuotation" q
  JOIN bridge_ai."QuoteRequest" request ON request.id = q."quoteRequestId"
  WHERE q.id = "quotationId"
    AND q.status = 'SUBMITTED'
    AND request.status IN ('OPEN','MATCHING','QUOTED')
    AND request."responseDueAt" > now()
    AND (SELECT bridge_private.has_company_membership(q."supplierCompanyId"))
    AND "submittedById" = (SELECT bridge_private.current_user_id())
));

CREATE POLICY quote_conversation_company_read ON bridge_ai."QuoteConversation" FOR SELECT TO authenticated
USING ((SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.has_company_membership("supplierCompanyId")) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY quote_conversation_company_insert ON bridge_ai."QuoteConversation" FOR INSERT TO authenticated
WITH CHECK ((SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.has_company_membership("supplierCompanyId")) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY quote_conversation_worker_update ON bridge_ai."QuoteConversation" FOR UPDATE TO authenticated
USING ((SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.has_company_membership("supplierCompanyId")) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')))
WITH CHECK ((SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.has_company_membership("supplierCompanyId")) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')));

CREATE POLICY quote_message_company_read ON bridge_ai."QuoteMessage" FOR SELECT TO authenticated
USING ((SELECT bridge_private.is_platform_admin()) OR EXISTS (
  SELECT 1 FROM bridge_ai."QuoteConversation" c WHERE c.id = "quoteConversationId"
    AND ((SELECT bridge_private.has_company_membership(c."supplierCompanyId")) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')))
));
CREATE POLICY quote_message_company_insert ON bridge_ai."QuoteMessage" FOR INSERT TO authenticated
WITH CHECK ((SELECT bridge_private.is_platform_admin()) OR EXISTS (
  SELECT 1 FROM bridge_ai."QuoteConversation" c WHERE c.id = "quoteConversationId" AND (
    ((SELECT bridge_private.has_company_membership(c."supplierCompanyId"))
      AND c.status = 'OPEN'
      AND sender = 'SUPPLIER'
      AND "senderUserId" = (SELECT bridge_private.current_user_id())
      AND "QuoteMessage".status = 'PENDING'
      AND "replyToId" IS NOT NULL
      AND "broadcastKey" IS NULL
      AND "questionDueAt" IS NULL
      AND "answeredAt" IS NULL
      AND "deliveredAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM bridge_ai."QuoteMessage" parent
        WHERE parent.id = "QuoteMessage"."replyToId"
          AND parent."quoteConversationId" = c.id
          AND parent.sender = 'BUYER'
          AND parent.status = 'DELIVERED'
          AND (parent."questionDueAt" IS NULL OR parent."questionDueAt" > now())
          AND NOT EXISTS (
            SELECT 1 FROM bridge_ai."QuoteMessage" answer
            WHERE answer."replyToId" = parent.id AND answer.sender = 'SUPPLIER'
          )
      ))
    OR ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')) AND sender IN ('BUYER','SYSTEM'))
  )
));
CREATE POLICY quote_message_worker_update ON bridge_ai."QuoteMessage" FOR UPDATE TO authenticated
USING ((SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')))
WITH CHECK ((SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')));

CREATE POLICY quote_moderation_company_read ON bridge_ai."QuoteMessageModerationEvent" FOR SELECT TO authenticated
USING ((SELECT bridge_private.is_platform_admin()) OR EXISTS (
  SELECT 1 FROM bridge_ai."QuoteConversation" c WHERE c.id = "quoteConversationId" AND (SELECT bridge_private.has_company_membership(c."supplierCompanyId"))
));
CREATE POLICY quote_moderation_company_insert ON bridge_ai."QuoteMessageModerationEvent" FOR INSERT TO authenticated
WITH CHECK ((SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')) OR (
  "actorUserId" = (SELECT bridge_private.current_user_id())
  AND outcome = 'BLOCKED'
  AND "quoteMessageId" IS NULL
  AND EXISTS (
    SELECT 1 FROM bridge_ai."QuoteConversation" c WHERE c.id = "quoteConversationId" AND (SELECT bridge_private.has_company_membership(c."supplierCompanyId"))
  )
));

CREATE POLICY quote_selection_admin_worker_manage ON bridge_ai."QuoteSelectionEvent" FOR ALL TO authenticated
USING ((SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')))
WITH CHECK ((SELECT bridge_private.is_platform_admin()) OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai')));
CREATE POLICY quote_selection_company_read ON bridge_ai."QuoteSelectionEvent" FOR SELECT TO authenticated
USING ((SELECT bridge_private.is_platform_admin()) OR EXISTS (
  SELECT 1 FROM bridge_ai."SupplierQuotation" q WHERE q.id = "quotationId" AND (SELECT bridge_private.has_company_membership(q."supplierCompanyId"))
));

CREATE POLICY whatsapp_ai_buyer_question_notification_insert
  ON bridge_ai."Notification" FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
    AND type = 'BUYER_QUESTION'
    AND "supplierCompanyId" IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM bridge_ai.company_memberships membership
      WHERE membership."userId" = "Notification"."userId"
        AND membership."supplierCompanyId" = "Notification"."supplierCompanyId"
        AND membership.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM bridge_ai."QuoteConversation" conversation
      JOIN bridge_ai."QuoteRequest" request ON request.id = conversation."quoteRequestId"
      WHERE conversation."supplierCompanyId" = "Notification"."supplierCompanyId"
        AND conversation.status = 'OPEN'
        AND "Notification"."actionUrl" = '/dashboard/requests/' || request.reference
    )
    AND (
      channel <> 'EMAIL'
      OR NOT EXISTS (
        SELECT 1 FROM bridge_ai."NotificationPreference" preference
        WHERE preference."userId" = "Notification"."userId"
          AND preference."supplierCompanyId" = "Notification"."supplierCompanyId"
          AND NOT preference."emailQuotationUpdates"
      )
    )
  );

DROP POLICY IF EXISTS supplier_email_notification_select ON bridge_ai."Notification";
CREATE POLICY supplier_email_notification_select
  ON bridge_ai."Notification" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('supplier_email')) AND type IN ('NEW_QUOTE_REQUEST', 'QUOTATION_ACCEPTED', 'BUYER_QUESTION') AND channel = 'EMAIL');

DROP POLICY IF EXISTS supplier_email_notification_update ON bridge_ai."Notification";
CREATE POLICY supplier_email_notification_update
  ON bridge_ai."Notification" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.is_trusted_worker('supplier_email')) AND type IN ('NEW_QUOTE_REQUEST', 'QUOTATION_ACCEPTED', 'BUYER_QUESTION') AND channel = 'EMAIL')
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('supplier_email')) AND type IN ('NEW_QUOTE_REQUEST', 'QUOTATION_ACCEPTED', 'BUYER_QUESTION') AND channel = 'EMAIL');

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE bridge_ai."QuoteConversation";
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE bridge_ai."QuoteMessage";
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", summary, metadata, "createdAt") VALUES (
  'system_multi_supplier_quote_conversations_20260812190328',
  'SYSTEM.MULTI_SUPPLIER_QUOTE_CONVERSATIONS_ENABLED', 'SecurityConfiguration',
  'Enabled encrypted, supplier-isolated quote conversations and immutable quotation versions',
  jsonb_build_object('anonymousLabels', 5, 'customerPortalAccounts', false, 'realtime', true, 'rlsForced', true), now()
);
