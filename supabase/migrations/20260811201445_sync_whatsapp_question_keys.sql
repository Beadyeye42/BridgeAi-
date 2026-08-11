-- The application persists the next deterministic intake question on the
-- conversation row. Keep every currently supported universal-request and
-- industry-specific question available at the database boundary.
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
      'REQUIRED_BY',
      'FULFILMENT',
      'CATEGORY',
      'COMPOSITE_STYLE',
      'ROOF_GLAZING_SPECIFICATION',
      'PHE_SPECIFICATION',
      'TRANSPORT_ROUTE_ITEM',
      'TRANSPORT_ACCESS',
      'TRANSPORT_HANDLING',
      'SPECIFICATION',
      'REQUIREMENTS',
      'NONE'
    )
  );

COMMENT ON COLUMN bridge_ai."Conversation"."aiLastQuestionKey" IS
  'Deterministic server-side WhatsApp intake state for universal and industry-specific request collection';
