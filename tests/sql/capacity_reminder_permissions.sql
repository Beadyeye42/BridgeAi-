-- Targeted rollback-only check using existing memberships: no users, jobs,
-- emails or subscriptions are created or changed. Run via the database owner.
BEGIN;
DO $test$
DECLARE
  member_a record;
  member_b record;
  row_count integer;
  test_id text := 'capacity_rls_probe_' || gen_random_uuid()::text;
BEGIN
  SELECT m.* INTO STRICT member_a FROM bridge_ai.company_memberships m
  WHERE m.status = 'ACTIVE' AND NOT EXISTS (
    SELECT 1 FROM bridge_ai.platform_administrators a WHERE a."userId" = m."userId" AND a.active
  ) LIMIT 1;
  SELECT m.* INTO STRICT member_b FROM bridge_ai.company_memberships m
  WHERE m.status = 'ACTIVE' AND m."supplierCompanyId" <> member_a."supplierCompanyId"
    AND m."userId" <> member_a."userId" LIMIT 1;

  INSERT INTO bridge_ai."Notification" (id,"userId","supplierCompanyId",type,channel,title,body,"actionUrl","createdAt")
  VALUES (test_id,member_b."userId",member_b."supplierCompanyId",'ACCOUNT_UPDATE','IN_APP',
    'Rollback security probe','Not delivered','/dashboard/capabilities',now());

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', member_a."userId"::text, true);
  -- A client must not become a trusted worker just by setting its context.
  PERFORM set_config('bridge_ai.worker_context', 'whatsapp_ai', true);
  IF bridge_private.is_trusted_worker('whatsapp_ai') THEN RAISE EXCEPTION 'Spoofed worker accepted'; END IF;
  SELECT count(*) INTO row_count FROM bridge_ai."Notification" WHERE id = test_id;
  IF row_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant reminder was visible'; END IF;
  BEGIN
    INSERT INTO bridge_ai."Notification" (id,"userId","supplierCompanyId",type,channel,title,body,"actionUrl","createdAt")
    VALUES (test_id || '_forbidden',member_b."userId",member_b."supplierCompanyId",'ACCOUNT_UPDATE','IN_APP',
      'Forbidden','Forbidden','/dashboard/capabilities',now());
    RAISE EXCEPTION 'Cross-tenant reminder insert succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', member_b."userId"::text, true);
  SELECT count(*) INTO row_count FROM bridge_ai."Notification" WHERE id = test_id;
  IF row_count <> 1 THEN RAISE EXCEPTION 'Member could not read own reminder'; END IF;
  EXECUTE 'RESET ROLE';
  IF NOT EXISTS (SELECT 1 FROM bridge_ai."AuditLog"
    WHERE action = 'SYSTEM.CAPACITY_REMINDER_PERMISSIONS_UPDATED') THEN
    RAISE EXCEPTION 'Migration audit missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'bridge_ai' AND c.relname = 'Notification' AND c.relrowsecurity AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION 'Notification RLS must be enabled and forced';
  END IF;
END
$test$;
ROLLBACK;
