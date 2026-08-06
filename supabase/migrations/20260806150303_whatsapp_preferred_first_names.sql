-- Keep the customer's chosen first name separate from Meta's mutable profile
-- display name. Both values remain encrypted by the server-only PII service.
ALTER TABLE bridge_ai."CustomerContact"
  ADD COLUMN "preferredFirstNameEncrypted" bytea,
  ADD COLUMN "preferredNameAskedAt" timestamptz;

COMMENT ON COLUMN bridge_ai."CustomerContact"."preferredFirstNameEncrypted" IS
  'AES-256-GCM ciphertext for the customer preferred first name; never supplier-visible before authorised contact unlock';

COMMENT ON COLUMN bridge_ai."CustomerContact"."preferredNameAskedAt" IS
  'Records that the WhatsApp concierge has already asked this contact for a preferred first name';

-- PREFERRED_NAME is deterministic application state, not a model-selectable
-- quote-intake question. Keep all existing trade-specific keys valid too.
ALTER TABLE bridge_ai."Conversation"
  DROP CONSTRAINT conversation_ai_question_key_valid,
  ADD CONSTRAINT conversation_ai_question_key_valid CHECK (
    "aiLastQuestionKey" IS NULL OR "aiLastQuestionKey" IN (
      'PREFERRED_NAME',
      'PRODUCT',
      'DELIVERY_POSTCODE',
      'CATEGORY',
      'COMPOSITE_STYLE',
      'ROOF_GLAZING_SPECIFICATION',
      'SPECIFICATION',
      'REQUIREMENTS',
      'NONE'
    )
  );
