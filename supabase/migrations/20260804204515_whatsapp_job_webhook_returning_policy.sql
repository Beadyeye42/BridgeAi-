-- Prisma inserts use RETURNING, so PostgreSQL evaluates both INSERT and SELECT
-- RLS policies for the new row. Keep webhook reads limited to inbound jobs while
-- retaining the AI worker's access to every job type it processes.
DROP POLICY whatsapp_ai_job_select ON bridge_ai."WhatsAppJob";

CREATE POLICY whatsapp_job_select
  ON bridge_ai."WhatsAppJob" FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
    OR (
      (SELECT bridge_private.is_trusted_worker('whatsapp_webhook'))
      AND type = 'PROCESS_INBOUND'
    )
  );
