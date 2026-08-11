-- Keep the persisted WhatsApp question state aligned with the universal
-- intake engine. Buyer audience is collected before matching so suppliers
-- only receive requests from customer types they have elected to serve.
ALTER TABLE bridge_ai."Conversation"
  DROP CONSTRAINT IF EXISTS conversation_ai_question_key_valid,
  ADD CONSTRAINT conversation_ai_question_key_valid CHECK (
    "aiLastQuestionKey" IS NULL OR "aiLastQuestionKey" IN (
      'PREFERRED_NAME',
      'QUOTE_OFFER',
      'INDUSTRY',
      'BUYER_TYPE',
      'PRODUCT',
      'DELIVERY_POSTCODE',
      'CATEGORY',
      'COMPOSITE_STYLE',
      'ROOF_GLAZING_SPECIFICATION',
      'PHE_SPECIFICATION',
      'SPECIFICATION',
      'REQUIREMENTS',
      'NONE'
    )
  );

COMMENT ON COLUMN bridge_ai."Conversation"."aiLastQuestionKey" IS
  'Deterministic server-side WhatsApp intake state, including buyer audience classification';
