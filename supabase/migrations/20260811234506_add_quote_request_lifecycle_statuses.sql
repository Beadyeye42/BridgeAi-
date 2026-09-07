-- PostgreSQL requires newly-added enum values to be committed before they are
-- referenced by table updates or functions. The follow-up migration performs
-- the data and invariant changes.
ALTER TYPE bridge_ai."QuoteRequestStatus" ADD VALUE IF NOT EXISTS 'SELECTED' AFTER 'QUOTED';
ALTER TYPE bridge_ai."QuoteRequestStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED' AFTER 'SELECTED';
ALTER TYPE bridge_ai."QuoteRequestStatus" ADD VALUE IF NOT EXISTS 'COMPLETED' AFTER 'CONFIRMED';
ALTER TYPE bridge_ai."QuoteRequestStatus" ADD VALUE IF NOT EXISTS 'CANCELLED_AFTER_SELECTION' AFTER 'COMPLETED';
