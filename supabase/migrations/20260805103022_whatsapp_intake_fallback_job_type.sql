-- PostgreSQL enum values must be committed before they are used by a later
-- constraint. Keep this change in its own migration.
ALTER TYPE bridge_ai."WhatsAppJobType" ADD VALUE IF NOT EXISTS 'SEND_INTAKE_FALLBACK';
