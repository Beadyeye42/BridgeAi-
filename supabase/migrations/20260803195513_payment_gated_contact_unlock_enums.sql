-- Commit enum additions before later migrations reference the new values.
ALTER TYPE bridge_ai."QuotationStatus" ADD VALUE IF NOT EXISTS 'SELECTED_PENDING_PAYMENT' AFTER 'SUBMITTED';
ALTER TYPE bridge_ai."NotificationType" ADD VALUE IF NOT EXISTS 'SUCCESS_FEE_DUE' AFTER 'QUOTATION_REJECTED';
ALTER TYPE bridge_ai."NotificationType" ADD VALUE IF NOT EXISTS 'CONTACT_DETAILS_UNLOCKED' AFTER 'SUCCESS_FEE_DUE';
