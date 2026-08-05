-- Each WhatsApp quote intake has an explicit boundary. This prevents messages
-- and private attachments from a previous request being reused in a new one.
ALTER TABLE bridge_ai."Conversation"
  ADD COLUMN "aiSessionStartedAt" timestamptz;

UPDATE bridge_ai."Conversation"
SET "aiSessionStartedAt" = "createdAt"
WHERE "aiSessionStartedAt" IS NULL;

ALTER TABLE bridge_ai."Conversation"
  ALTER COLUMN "aiSessionStartedAt" SET DEFAULT now(),
  ALTER COLUMN "aiSessionStartedAt" SET NOT NULL;
