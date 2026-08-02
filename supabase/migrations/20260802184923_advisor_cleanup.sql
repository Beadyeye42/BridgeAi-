-- Remove dormant legacy policies and close advisor-detected index gaps.
DO $$
DECLARE legacy_table text;
DECLARE policy_name text;
BEGIN
  FOREACH legacy_table IN ARRAY ARRAY['profiles','quotes','request_customers','requests','subscriptions','whatsapp_messages']
  LOOP
    IF to_regclass(format('public.%I', legacy_table)) IS NOT NULL THEN
      FOR policy_name IN
        SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=legacy_table
      LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', policy_name, legacy_table);
      END LOOP;
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        legacy_table || '_quarantined', legacy_table
      );
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS "SupplierAssignment_assignedById_idx"
  ON bridge_ai."SupplierAssignment" ("assignedById");
CREATE INDEX IF NOT EXISTS "SystemEvent_resolvedById_idx"
  ON bridge_ai."SystemEvent" ("resolvedById");
CREATE INDEX IF NOT EXISTS "administrator_permissions_permissionId_idx"
  ON bridge_ai.administrator_permissions ("permissionId");
CREATE INDEX IF NOT EXISTS subscriptions_supplier_id_idx
  ON public.subscriptions (supplier_id);
CREATE INDEX IF NOT EXISTS whatsapp_messages_request_id_idx
  ON public.whatsapp_messages (request_id);
