-- Support foreign-key checks and user/message lookups without full-table scans.
-- These indexes are intentionally single-column because PostgreSQL's foreign-key
-- enforcement and the relevant tenant-scoped joins start with these identifiers.
CREATE INDEX IF NOT EXISTS "QuotationVersion_submittedById_idx"
  ON bridge_ai."QuotationVersion" ("submittedById");

CREATE INDEX IF NOT EXISTS "QuoteMessage_senderUserId_idx"
  ON bridge_ai."QuoteMessage" ("senderUserId");

CREATE INDEX IF NOT EXISTS "QuoteMessageModerationEvent_quoteMessageId_idx"
  ON bridge_ai."QuoteMessageModerationEvent" ("quoteMessageId");

CREATE INDEX IF NOT EXISTS "QuoteMessageModerationEvent_actorUserId_idx"
  ON bridge_ai."QuoteMessageModerationEvent" ("actorUserId");
