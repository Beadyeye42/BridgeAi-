ALTER TYPE bridge_ai."NotificationType" ADD VALUE IF NOT EXISTS 'BUYER_QUESTION';
ALTER TYPE bridge_ai."NotificationType" ADD VALUE IF NOT EXISTS 'QUOTE_REVISED';
ALTER TYPE bridge_ai."WhatsAppJobType" ADD VALUE IF NOT EXISTS 'SEND_QUOTE_MESSAGE';

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", summary, metadata, "createdAt") VALUES (
  'system_multi_supplier_quote_enums_20260812190300',
  'SYSTEM.MULTI_SUPPLIER_QUOTE_ENUMS_ENABLED',
  'SecurityConfiguration',
  'Committed the multi-supplier conversation notification and WhatsApp job values before dependent policies',
  jsonb_build_object('notificationTypes', jsonb_build_array('BUYER_QUESTION', 'QUOTE_REVISED'), 'jobType', 'SEND_QUOTE_MESSAGE'),
  now()
);
