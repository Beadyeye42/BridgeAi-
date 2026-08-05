-- Keep deterministic conversation progress on the server so duplicate or
-- ambiguous customer turns cannot make the AI loop indefinitely.
ALTER TABLE bridge_ai."Conversation"
  ADD COLUMN "aiDraftFingerprint" varchar(64),
  ADD COLUMN "aiLastQuestionKey" varchar(32),
  ADD COLUMN "aiUnproductiveTurns" integer NOT NULL DEFAULT 0,
  ADD COLUMN "aiLastProgressAt" timestamptz;

ALTER TABLE bridge_ai."Conversation"
  ADD CONSTRAINT conversation_ai_draft_fingerprint_valid CHECK (
    "aiDraftFingerprint" IS NULL OR "aiDraftFingerprint" ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT conversation_ai_question_key_valid CHECK (
    "aiLastQuestionKey" IS NULL OR "aiLastQuestionKey" IN (
      'PRODUCT', 'DELIVERY_POSTCODE', 'CATEGORY', 'SPECIFICATION', 'REQUIREMENTS', 'NONE'
    )
  ),
  ADD CONSTRAINT conversation_ai_unproductive_turns_valid CHECK (
    "aiUnproductiveTurns" BETWEEN 0 AND 3
  );

-- The customer confirmation message is the database-level idempotency key for
-- quote publication. A retried worker cannot publish the same request twice.
ALTER TABLE bridge_ai."QuoteRequest"
  ADD COLUMN "customerConfirmationMessageId" text;

CREATE UNIQUE INDEX "QuoteRequest_customerConfirmationMessageId_key"
  ON bridge_ai."QuoteRequest" ("customerConfirmationMessageId")
  WHERE "customerConfirmationMessageId" IS NOT NULL;

-- The fallback carries no customer content. It only sends a fixed recovery
-- acknowledgement and moves the conversation into administrator review.
ALTER TABLE bridge_ai."WhatsAppJob"
  DROP CONSTRAINT whatsapp_job_parent_valid,
  ADD CONSTRAINT whatsapp_job_parent_valid CHECK (
    (type = 'PROCESS_INBOUND'
      AND "conversationId" IS NOT NULL
      AND "whatsappMessageId" IS NOT NULL
      AND "quoteRequestId" IS NULL
      AND "quotationId" IS NULL)
    OR
    (type = 'SEND_INTAKE_FALLBACK'
      AND "conversationId" IS NOT NULL
      AND "whatsappMessageId" IS NULL
      AND "quoteRequestId" IS NULL
      AND "quotationId" IS NULL)
    OR
    (type IN ('SEND_QUOTE_SUMMARY', 'SEND_CONTACT_UNLOCK')
      AND "conversationId" IS NOT NULL
      AND "whatsappMessageId" IS NULL
      AND "quoteRequestId" IS NOT NULL
      AND "quotationId" IS NOT NULL)
  );
