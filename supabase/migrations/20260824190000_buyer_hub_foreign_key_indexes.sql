CREATE INDEX IF NOT EXISTS "BuyerLoginChallenge_authUserId_idx"
  ON bridge_ai."BuyerLoginChallenge" ("authUserId");

CREATE INDEX IF NOT EXISTS "BuyerOrderEvent_actorAuthUserId_idx"
  ON bridge_ai."BuyerOrderEvent" ("actorAuthUserId");

INSERT INTO bridge_ai."AuditLog" (
  id,
  action,
  "entityType",
  summary,
  metadata,
  "createdAt"
)
VALUES (
  'system_buyer_hub_fk_indexes_20260824190000',
  'SYSTEM.BUYER_HUB_FOREIGN_KEY_INDEXES_ENABLED',
  'SecurityConfiguration',
  'Added covering indexes for Buyer Hub authentication and order-event foreign keys.',
  jsonb_build_object('indexes', ARRAY[
    'BuyerLoginChallenge_authUserId_idx',
    'BuyerOrderEvent_actorAuthUserId_idx'
  ]),
  now()
);
