CREATE TYPE bridge_ai."BuyerType" AS ENUM ('CONSUMER', 'TRADE', 'BUSINESS');
CREATE TYPE bridge_ai."IntentQuality" AS ENUM ('BROWSING', 'QUALIFIED', 'URGENT', 'READY_TO_BUY');

ALTER TABLE bridge_ai."ProductCategory"
  ADD COLUMN "servesConsumer" boolean NOT NULL DEFAULT false,
  ADD COLUMN "servesTrade" boolean NOT NULL DEFAULT true,
  ADD COLUMN "servesBusiness" boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT product_category_audience_required CHECK (
    "servesConsumer" OR "servesTrade" OR "servesBusiness"
  );

ALTER TABLE bridge_ai."SupplierCapability"
  ADD COLUMN "servesConsumer" boolean NOT NULL DEFAULT false,
  ADD COLUMN "servesTrade" boolean NOT NULL DEFAULT true,
  ADD COLUMN "servesBusiness" boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT supplier_capability_audience_required CHECK (
    "servesConsumer" OR "servesTrade" OR "servesBusiness"
  );

ALTER TABLE bridge_ai."QuoteRequest"
  ADD COLUMN "buyerType" bridge_ai."BuyerType" NOT NULL DEFAULT 'TRADE',
  ADD COLUMN "intentQuality" bridge_ai."IntentQuality" NOT NULL DEFAULT 'READY_TO_BUY';

-- First-party launch defaults. Consumer work is deliberately opt-in at the
-- supplier capability level, so this does not expose existing suppliers to a
-- new audience until they choose it.
UPDATE bridge_ai."ProductCategory"
SET "servesConsumer" = CASE
      WHEN slug IN (
        'windows',
        'plumbing-heating-mechanical',
        'garage-industrial-specialist-doors',
        'transport-delivery-removals'
      ) THEN true
      ELSE false
    END,
    "servesTrade" = true,
    "servesBusiness" = true,
    "updatedAt" = now()
WHERE "parentId" IS NULL;

CREATE INDEX "QuoteRequest_buyerType_intentQuality_status_idx"
  ON bridge_ai."QuoteRequest" ("buyerType", "intentQuality", status);
CREATE INDEX "SupplierCapability_productCategoryId_audience_active_idx"
  ON bridge_ai."SupplierCapability" (
    "productCategoryId", "servesConsumer", "servesTrade", "servesBusiness", active
  );

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_buyer_audience_matching_v1',
  'SYSTEM.BUYER_AUDIENCE_MATCHING_ENABLED',
  'MatchingConfiguration',
  'buyer_audience_matching_v1',
  'Buyer classification and supplier audience matching enabled',
  jsonb_build_object(
    'buyerTypes', jsonb_build_array('CONSUMER', 'TRADE', 'BUSINESS'),
    'intentQualities', jsonb_build_array('BROWSING', 'QUALIFIED', 'URGENT', 'READY_TO_BUY'),
    'existingSupplierConsumerDefault', false,
    'existingSupplierTradeDefault', true,
    'existingSupplierBusinessDefault', true
  ),
  now()
) ON CONFLICT (id) DO NOTHING;

COMMENT ON COLUMN bridge_ai."QuoteRequest"."buyerType" IS
  'Buyer audience inferred conversationally and confirmed only when necessary.';
COMMENT ON COLUMN bridge_ai."QuoteRequest"."intentQuality" IS
  'Commercial readiness classification recorded when the request is published.';
COMMENT ON COLUMN bridge_ai."SupplierCapability"."servesConsumer" IS
  'Explicit supplier opt-in to consumer or homeowner requests for this capability.';
