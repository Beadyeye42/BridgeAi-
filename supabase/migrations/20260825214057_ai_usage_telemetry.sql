CREATE TABLE IF NOT EXISTS bridge_ai."AiUsageEvent" (
  id text PRIMARY KEY,
  model text NOT NULL,
  task text NOT NULL,
  "inputTokens" integer,
  "cachedInputTokens" integer,
  "outputTokens" integer,
  "reasoningTokens" integer,
  "latencyMs" integer NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  "escalationLevel" text NOT NULL,
  "escalationReason" text NOT NULL,
  "providerResponseIdHash" text NOT NULL,
  "requestId" text,
  "workflowId" text,
  "quoteRequestId" text,
  "estimatedCostUsd" numeric(18,8) NOT NULL,
  "createdAt" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "AiUsageEvent_createdAt_idx"
  ON bridge_ai."AiUsageEvent" ("createdAt");
CREATE INDEX IF NOT EXISTS "AiUsageEvent_model_createdAt_idx"
  ON bridge_ai."AiUsageEvent" (model, "createdAt");
CREATE INDEX IF NOT EXISTS "AiUsageEvent_task_createdAt_idx"
  ON bridge_ai."AiUsageEvent" (task, "createdAt");
CREATE INDEX IF NOT EXISTS "AiUsageEvent_workflowId_createdAt_idx"
  ON bridge_ai."AiUsageEvent" ("workflowId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiUsageEvent_quoteRequestId_createdAt_idx"
  ON bridge_ai."AiUsageEvent" ("quoteRequestId", "createdAt");

ALTER TABLE bridge_ai."AiUsageEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."AiUsageEvent" FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON bridge_ai."AiUsageEvent"
  TO authenticated, bridge_ai_app;
REVOKE ALL ON bridge_ai."AiUsageEvent" FROM PUBLIC, anon, service_role;

DROP POLICY IF EXISTS platform_administrator_read ON bridge_ai."AiUsageEvent";
CREATE POLICY platform_administrator_read
  ON bridge_ai."AiUsageEvent"
  FOR SELECT
  TO authenticated
  USING ((SELECT bridge_private.is_platform_admin()));

DROP POLICY IF EXISTS whatsapp_ai_insert ON bridge_ai."AiUsageEvent";
CREATE POLICY whatsapp_ai_insert
  ON bridge_ai."AiUsageEvent"
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT bridge_private.is_trusted_worker('whatsapp_ai')));

COMMENT ON TABLE bridge_ai."AiUsageEvent" IS
  'Private per-call OpenAI usage and routing telemetry. Raw prompts, files, contact details and provider response IDs must never be stored here.';
