CREATE TYPE bridge_ai."ProductionAlertStatus" AS ENUM (
  'PENDING', 'PROCESSING', 'SENT', 'FAILED'
);

CREATE TABLE bridge_ai."ProductionAlert" (
  id text PRIMARY KEY,
  fingerprint text NOT NULL UNIQUE,
  source text NOT NULL,
  severity bridge_ai."SystemEventSeverity" NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  "actionUrl" text,
  status bridge_ai."ProductionAlertStatus" NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  "availableAt" timestamptz(3) NOT NULL DEFAULT now(),
  "lockedAt" timestamptz(3),
  "sentAt" timestamptz(3),
  "failedAt" timestamptz(3),
  "lastError" text,
  "providerEmailId" text,
  "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamptz(3) NOT NULL
);

CREATE INDEX "ProductionAlert_status_availableAt_createdAt_idx"
  ON bridge_ai."ProductionAlert" (status, "availableAt", "createdAt");
CREATE INDEX "ProductionAlert_source_createdAt_idx"
  ON bridge_ai."ProductionAlert" (source, "createdAt");

ALTER TABLE bridge_ai."ProductionAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."ProductionAlert" FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON bridge_ai."ProductionAlert"
  TO authenticated, bridge_ai_app;
REVOKE ALL ON bridge_ai."ProductionAlert" FROM anon, service_role;

CREATE POLICY platform_administrator_all
  ON bridge_ai."ProductionAlert"
  FOR ALL
  TO authenticated
  USING ((SELECT bridge_private.is_platform_admin()))
  WITH CHECK ((SELECT bridge_private.is_platform_admin()));

COMMENT ON TABLE bridge_ai."ProductionAlert" IS
  'Deduplicated transactional outbox for production operational alert emails.';
