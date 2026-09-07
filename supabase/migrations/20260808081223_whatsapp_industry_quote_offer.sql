-- Record the explicit consent-to-quote hand-off separately from quote
-- confirmation. This prevents a natural "yes" to a sales offer from ever
-- publishing an incomplete request, while preserving deterministic intake.
ALTER TABLE bridge_ai."Conversation"
  DROP CONSTRAINT IF EXISTS conversation_ai_question_key_valid,
  ADD CONSTRAINT conversation_ai_question_key_valid CHECK (
    "aiLastQuestionKey" IS NULL OR "aiLastQuestionKey" IN (
      'PREFERRED_NAME',
      'QUOTE_OFFER',
      'INDUSTRY',
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
  'Deterministic server-side WhatsApp intake state; QUOTE_OFFER is distinct from final quote confirmation';
