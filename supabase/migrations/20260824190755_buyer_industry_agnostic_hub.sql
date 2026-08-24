-- Buyer Hub keeps only platform-wide outcome state in code. Industry wording,
-- fields and intermediate lifecycle stages live in ProductCategory JSON config.
CREATE TYPE bridge_ai."BuyerOrderState" AS ENUM (
  'SELECTED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ISSUE_REPORTED'
);

ALTER TABLE bridge_ai."ProductCategory"
  ADD COLUMN "buyerExperienceConfig" jsonb;

ALTER TABLE bridge_ai."ProductCategory"
  ADD CONSTRAINT "ProductCategory_buyerExperienceConfig_object_check"
    CHECK ("buyerExperienceConfig" IS NULL OR jsonb_typeof("buyerExperienceConfig") = 'object'),
  ADD CONSTRAINT "ProductCategory_buyerExperienceConfig_industry_only_check"
    CHECK ("buyerExperienceConfig" IS NULL OR "parentId" IS NULL);

ALTER TABLE bridge_ai."BuyerOrder"
  ADD COLUMN state bridge_ai."BuyerOrderState" NOT NULL DEFAULT 'SELECTED',
  ADD COLUMN "stageKey" varchar(64) NOT NULL DEFAULT 'selected';

ALTER TABLE bridge_ai."BuyerOrder"
  ADD CONSTRAINT "BuyerOrder_stageKey_format_check"
    CHECK ("stageKey" ~ '^[a-z][a-z0-9_]{1,63}$');

UPDATE bridge_ai."BuyerOrder"
SET
  state = CASE
    WHEN status = 'COMPLETED' THEN 'COMPLETED'::bridge_ai."BuyerOrderState"
    WHEN status = 'CANCELLED' THEN 'CANCELLED'::bridge_ai."BuyerOrderState"
    WHEN status = 'ISSUE_REPORTED' THEN 'ISSUE_REPORTED'::bridge_ai."BuyerOrderState"
    WHEN status = 'PENDING_CONFIRMATION' THEN 'SELECTED'::bridge_ai."BuyerOrderState"
    ELSE 'ACTIVE'::bridge_ai."BuyerOrderState"
  END,
  "stageKey" = CASE status::text
    WHEN 'PENDING_CONFIRMATION' THEN 'selected'
    WHEN 'CONFIRMED' THEN 'confirmed'
    WHEN 'COMPLETED' THEN 'completed'
    WHEN 'CANCELLED' THEN 'cancelled'
    WHEN 'ISSUE_REPORTED' THEN 'issue_reported'
    ELSE lower(status::text)
  END;

ALTER TABLE bridge_ai."BuyerOrderEvent"
  ADD COLUMN state bridge_ai."BuyerOrderState" NOT NULL DEFAULT 'SELECTED',
  ADD COLUMN "stageKey" varchar(64) NOT NULL DEFAULT 'selected';

ALTER TABLE bridge_ai."BuyerOrderEvent"
  ADD CONSTRAINT "BuyerOrderEvent_stageKey_format_check"
    CHECK ("stageKey" ~ '^[a-z][a-z0-9_]{1,63}$');

UPDATE bridge_ai."BuyerOrderEvent"
SET
  state = CASE
    WHEN status = 'COMPLETED' THEN 'COMPLETED'::bridge_ai."BuyerOrderState"
    WHEN status = 'CANCELLED' THEN 'CANCELLED'::bridge_ai."BuyerOrderState"
    WHEN status = 'ISSUE_REPORTED' THEN 'ISSUE_REPORTED'::bridge_ai."BuyerOrderState"
    WHEN status = 'PENDING_CONFIRMATION' THEN 'SELECTED'::bridge_ai."BuyerOrderState"
    ELSE 'ACTIVE'::bridge_ai."BuyerOrderState"
  END,
  "stageKey" = CASE status::text
    WHEN 'PENDING_CONFIRMATION' THEN 'selected'
    WHEN 'CONFIRMED' THEN 'confirmed'
    WHEN 'COMPLETED' THEN 'completed'
    WHEN 'CANCELLED' THEN 'cancelled'
    WHEN 'ISSUE_REPORTED' THEN 'issue_reported'
    ELSE lower(status::text)
  END;

DROP INDEX IF EXISTS bridge_ai."BuyerOrder_customerContactId_status_createdAt_idx";
DROP INDEX IF EXISTS bridge_ai."BuyerOrder_supplierCompanyId_status_createdAt_idx";
ALTER TABLE bridge_ai."BuyerOrder" DROP COLUMN status;
ALTER TABLE bridge_ai."BuyerOrderEvent" DROP COLUMN status;
DROP TYPE bridge_ai."BuyerOrderStatus";

CREATE INDEX "BuyerOrder_customerContactId_state_createdAt_idx"
  ON bridge_ai."BuyerOrder" ("customerContactId", state, "createdAt");
CREATE INDEX "BuyerOrder_supplierCompanyId_state_createdAt_idx"
  ON bridge_ai."BuyerOrder" ("supplierCompanyId", state, "createdAt");

COMMENT ON COLUMN bridge_ai."ProductCategory"."buyerExperienceConfig" IS
  'Versioned Buyer Hub labels, configurable detail fields and lifecycle stages for a top-level industry.';
COMMENT ON COLUMN bridge_ai."BuyerOrder".state IS
  'Industry-agnostic platform outcome used for access, reporting and rewards.';
COMMENT ON COLUMN bridge_ai."BuyerOrder"."stageKey" IS
  'Industry-defined lifecycle stage resolved through ProductCategory buyerExperienceConfig.';

-- Store current specialist next steps as data, never as shared Buyer Hub code.
UPDATE bridge_ai."ProductCategory"
SET "buyerExperienceConfig" = jsonb_build_object(
  'version', 1,
  'labels', jsonb_build_object(
    'requestSingular', 'request', 'requestPlural', 'requests',
    'orderSingular', 'arrangement', 'orderPlural', 'arrangements',
    'location', 'Location', 'requiredBy', 'Required by',
    'items', 'Requirements', 'files', 'Files', 'quote', 'Quote', 'quotePlural', 'Quotes'
  ),
  'detailFields', '[]'::jsonb,
  'stages', jsonb_build_array(
    jsonb_build_object('key', 'selected', 'label', 'Supplier selected', 'state', 'SELECTED', 'nextAction', 'Contact the buyer and agree the final arrangements.', 'allowedNext', jsonb_build_array('confirmed', 'cancelled')),
    jsonb_build_object('key', 'confirmed', 'label', 'Arrangements confirmed', 'state', 'ACTIVE', 'nextAction', 'Complete the agreed supply, hire, manufacture, delivery or service.', 'allowedNext', jsonb_build_array('completed', 'cancelled')),
    jsonb_build_object('key', 'completed', 'label', 'Completed', 'state', 'COMPLETED', 'allowedNext', '[]'::jsonb),
    jsonb_build_object('key', 'cancelled', 'label', 'Did not proceed', 'state', 'CANCELLED', 'allowedNext', '[]'::jsonb),
    jsonb_build_object('key', 'issue_reported', 'label', 'Issue reported', 'state', 'ISSUE_REPORTED', 'allowedNext', jsonb_build_array('confirmed', 'cancelled'))
  )
)
WHERE "parentId" IS NULL;
