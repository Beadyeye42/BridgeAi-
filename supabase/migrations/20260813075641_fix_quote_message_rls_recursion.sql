-- QuoteMessage's original INSERT policy queried QuoteMessage again to validate
-- supplier replies. PostgreSQL evaluates RLS policies before it can short-circuit
-- the trusted WhatsApp worker branch, so even legitimate buyer questions failed
-- with "infinite recursion detected in policy". Keep the policy non-recursive and
-- enforce reply-to invariants in the existing private trigger instead.

CREATE OR REPLACE FUNCTION bridge_private.enforce_quote_message_reply_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent_message bridge_ai."QuoteMessage"%ROWTYPE;
BEGIN
  IF NEW."replyToId" IS NOT NULL THEN
    SELECT * INTO parent_message
    FROM bridge_ai."QuoteMessage" parent
    WHERE parent.id = NEW."replyToId"
      AND parent."quoteConversationId" = NEW."quoteConversationId";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'QUOTE_MESSAGE_REPLY_SCOPE_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.sender = 'SUPPLIER' THEN
    IF NEW.status <> 'PENDING'
       OR NEW."senderUserId" IS NULL
       OR NEW."replyToId" IS NULL
       OR NEW."broadcastKey" IS NOT NULL
       OR NEW."questionDueAt" IS NOT NULL
       OR NEW."answeredAt" IS NOT NULL
       OR NEW."deliveredAt" IS NOT NULL THEN
      RAISE EXCEPTION 'QUOTE_MESSAGE_SUPPLIER_REPLY_INVALID' USING ERRCODE = '23514';
    END IF;

    IF parent_message.sender <> 'BUYER'
       OR parent_message.status <> 'DELIVERED'
       OR (parent_message."questionDueAt" IS NOT NULL AND parent_message."questionDueAt" <= now()) THEN
      RAISE EXCEPTION 'QUOTE_MESSAGE_QUESTION_NOT_OPEN' USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM bridge_ai."QuoteMessage" answer
      WHERE answer."replyToId" = parent_message.id
        AND answer.sender = 'SUPPLIER'
        AND answer.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'QUOTE_MESSAGE_ALREADY_ANSWERED' USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_quote_message_reply_scope()
  FROM PUBLIC, anon, authenticated, service_role, bridge_ai_app;

DROP POLICY IF EXISTS quote_message_company_insert ON bridge_ai."QuoteMessage";
DROP POLICY IF EXISTS quote_message_admin_worker_insert ON bridge_ai."QuoteMessage";
DROP POLICY IF EXISTS quote_message_supplier_insert ON bridge_ai."QuoteMessage";

CREATE POLICY quote_message_admin_worker_insert
  ON bridge_ai."QuoteMessage"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_platform_admin())
    OR (
      (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
      AND sender IN ('BUYER', 'SYSTEM')
    )
  );

CREATE POLICY quote_message_supplier_insert
  ON bridge_ai."QuoteMessage"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender = 'SUPPLIER'
    AND "senderUserId" = (SELECT bridge_private.current_user_id())
    AND status = 'PENDING'
    AND "replyToId" IS NOT NULL
    AND "broadcastKey" IS NULL
    AND "questionDueAt" IS NULL
    AND "answeredAt" IS NULL
    AND "deliveredAt" IS NULL
    AND EXISTS (
      SELECT 1
      FROM bridge_ai."QuoteConversation" conversation
      WHERE conversation.id = "quoteConversationId"
        AND conversation.status = 'OPEN'
        AND (SELECT bridge_private.has_company_membership(conversation."supplierCompanyId"))
    )
  );

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", summary, metadata, "createdAt"
) VALUES (
  'system_quote_message_rls_recursion_fix_20260813075641',
  'SYSTEM.QUOTE_MESSAGE_RLS_RECURSION_FIXED',
  'SecurityConfiguration',
  'Replaced the recursive quote-message insert policy with isolated worker and supplier policies',
  jsonb_build_object(
    'workerInsertRestrictedTo', jsonb_build_array('BUYER', 'SYSTEM'),
    'supplierReplyValidation', 'private_trigger',
    'tenantIsolation', true
  ),
  now()
);
