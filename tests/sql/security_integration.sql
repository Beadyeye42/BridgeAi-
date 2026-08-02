-- Run against a disposable/local Supabase database or inside a transaction on the isolated test project.
-- It uses two existing auth.users identities and rolls back all fixtures.
BEGIN;

DO $test$
DECLARE
  user_a uuid;
  user_b uuid;
  visible_count integer;
  affected_count integer;
BEGIN
  SELECT id INTO user_a FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO user_b FROM auth.users ORDER BY created_at OFFSET 1 LIMIT 1;
  IF user_a IS NULL OR user_b IS NULL THEN
    RAISE EXCEPTION 'security integration test requires two auth users';
  END IF;

  INSERT INTO bridge_ai.portal_profiles (id,email,"firstName","lastName",status,"createdAt","updatedAt") VALUES
    (user_a,'rls-a@bridge.test','Supplier','A','ACTIVE',now(),now()),
    (user_b,'rls-b@bridge.test','Supplier','B','ACTIVE',now(),now());
  INSERT INTO bridge_ai.supplier_companies (id,"legalName","contactEmail","contactPhone",status,"createdAt","updatedAt") VALUES
    ('security_company_a','Security Company A','a@bridge.test','1','APPROVED',now(),now()),
    ('security_company_b','Security Company B','b@bridge.test','2','APPROVED',now(),now()),
    ('security_company_c','Security Company C','c@bridge.test','3','APPROVED',now(),now());
  INSERT INTO bridge_ai.company_memberships (id,"userId","supplierCompanyId",role,status,"isPrimary","joinedAt") VALUES
    ('security_membership_a',user_a,'security_company_a','OWNER','ACTIVE',true,now()),
    ('security_membership_b',user_b,'security_company_b','OWNER','ACTIVE',true,now());

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);

  SELECT count(*) INTO visible_count FROM bridge_ai.supplier_companies WHERE id = 'security_company_b';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'Supplier A selected Supplier B company'; END IF;

  UPDATE bridge_ai.supplier_companies SET "legalName"='forbidden' WHERE id='security_company_b';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 0 THEN RAISE EXCEPTION 'Supplier A updated Supplier B company'; END IF;

  BEGIN
    INSERT INTO bridge_ai.company_memberships (id,"userId","supplierCompanyId",role,status,"isPrimary","joinedAt")
    VALUES ('forbidden_membership',user_a,'security_company_b','MEMBER','ACTIVE',false,now());
    RAISE EXCEPTION 'Supplier A inserted a Supplier B membership';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE bridge_ai.company_memberships SET role='MEMBER' WHERE id='security_membership_a';
    RAISE EXCEPTION 'user changed their own company role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id,name,owner_id)
    VALUES ('bridge-ai-private','companies/security_company_b/forbidden.txt',user_a::text);
    RAISE EXCEPTION 'Supplier A inserted a Supplier B storage object';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO storage.objects (bucket_id,name,owner_id)
  VALUES ('bridge-ai-private','companies/security_company_a/allowed.txt',user_a::text);

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);

  INSERT INTO storage.objects (bucket_id,name,owner_id)
  VALUES ('bridge-ai-private','companies/security_company_b/b.txt',user_b::text);
  INSERT INTO bridge_ai."AuditLog" (id,"actorUserId","supplierCompanyId",action,"entityType",summary,"createdAt")
  VALUES ('security_audit',user_a,'security_company_a','SECURITY.TEST','Test','immutable',now());

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);

  SELECT count(*) INTO visible_count FROM storage.objects
  WHERE bucket_id='bridge-ai-private' AND name='companies/security_company_b/b.txt';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'Supplier A selected Supplier B storage object'; END IF;

  SELECT count(*) INTO visible_count FROM storage.objects
  WHERE bucket_id='bridge-ai-private' AND name='companies/security_company_a/allowed.txt';
  IF visible_count <> 1 THEN RAISE EXCEPTION 'Supplier A could not read own Storage object'; END IF;

  UPDATE storage.objects SET metadata='{"security_test":true}'::jsonb
  WHERE bucket_id='bridge-ai-private' AND name='companies/security_company_a/allowed.txt';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 1 THEN RAISE EXCEPTION 'Supplier A could not replace own Storage object'; END IF;

  UPDATE storage.objects SET metadata='{"forbidden":true}'::jsonb
  WHERE bucket_id='bridge-ai-private' AND name='companies/security_company_b/b.txt';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 0 THEN RAISE EXCEPTION 'Supplier A replaced Supplier B Storage object'; END IF;

  UPDATE bridge_ai."AuditLog" SET summary='changed' WHERE id='security_audit';
  DELETE FROM bridge_ai."AuditLog" WHERE id='security_audit';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (SELECT summary FROM bridge_ai."AuditLog" WHERE id='security_audit') <> 'immutable' THEN
    RAISE EXCEPTION 'normal application access mutated audit data';
  END IF;

  SELECT count(*) INTO visible_count FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects'
    AND policyname='bridge_ai_storage_delete' AND cmd='DELETE'
    AND roles @> ARRAY['authenticated']::name[];
  IF visible_count <> 1 THEN RAISE EXCEPTION 'authenticated Storage delete policy is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM bridge_ai."AuditLog" WHERE id='security_audit') THEN
    RAISE EXCEPTION 'normal application access deleted audit data';
  END IF;

  INSERT INTO bridge_ai.platform_administrators ("userId",active,"createdAt","updatedAt")
  VALUES (user_a,true,now(),now());
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
  SELECT count(*) INTO visible_count FROM bridge_ai.supplier_companies WHERE id='security_company_b';
  IF visible_count <> 1 THEN RAISE EXCEPTION 'verified administrator bypass failed'; END IF;
  EXECUTE 'RESET ROLE';
  UPDATE bridge_ai.platform_administrators SET active=false WHERE "userId"=user_a;
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO visible_count FROM bridge_ai.supplier_companies WHERE id='security_company_b';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'inactive administrator retained bypass'; END IF;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);

  UPDATE bridge_ai.company_memberships SET status='SUSPENDED' WHERE id='security_membership_a';
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO visible_count FROM bridge_ai.supplier_companies WHERE id='security_company_a';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'suspended membership retained access'; END IF;
  EXECUTE 'RESET ROLE';
  UPDATE bridge_ai.company_memberships SET status='ACTIVE' WHERE id='security_membership_a';

  BEGIN
    INSERT INTO bridge_ai.portal_profiles (id,email,"firstName","lastName",status,"createdAt","updatedAt")
    VALUES (gen_random_uuid(),'RLS-A@BRIDGE.TEST','Duplicate','Email','ACTIVE',now(),now());
    RAISE EXCEPTION 'case-insensitive duplicate email accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO bridge_ai.company_memberships (id,"userId","supplierCompanyId",role,status,"isPrimary","joinedAt")
    VALUES ('second_primary',user_a,'security_company_c','MEMBER','ACTIVE',true,now());
    RAISE EXCEPTION 'multiple primary memberships accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO bridge_ai."CustomerContact" (id,"displayName","phoneEncrypted","phoneHash","createdAt","updatedAt")
  VALUES ('security_customer','Test',decode('00','hex'),'security-phone-hash',now(),now());
  INSERT INTO bridge_ai."ProductCategory" (id,name,slug,active,"displayOrder","createdAt","updatedAt")
  VALUES ('security_category','Security category','security-category',true,0,now(),now());
  INSERT INTO bridge_ai."QuoteRequest" (
    id,reference,"customerContactId","categoryId",title,summary,"deliveryPostcode",currency,status,
    "distributionLimit","responseDueAt","createdAt","updatedAt"
  ) VALUES (
    'security_request','SECURITY-1','security_customer','security_category','Test','Test','B1','GBP','OPEN',
    1,now()+interval '1 day',now(),now()
  );
  INSERT INTO bridge_ai."SupplierAssignment" (
    id,"quoteRequestId","supplierCompanyId",status,"assignedAt","expiresAt"
  ) VALUES ('security_assignment','security_request','security_company_a','PENDING',now(),now()+interval '1 day');

  BEGIN
    INSERT INTO bridge_ai."QuoteRequestItem" (id,"quoteRequestId",description,quantity,unit,"displayOrder","createdAt")
    VALUES ('bad_quantity','security_request','bad',0,'each',0,now());
    RAISE EXCEPTION 'zero quantity accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO bridge_ai."CoverageArea" (id,"supplierCompanyId",type,label,"centrePostcode","radiusMiles",active,"createdAt","updatedAt")
    VALUES ('bad_radius','security_company_a','DISTANCE','bad','B1',-1,true,now(),now());
    RAISE EXCEPTION 'negative coverage radius accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO bridge_ai."QuoteRequest" (
      id,reference,"customerContactId","categoryId",title,summary,"deliveryPostcode",currency,status,
      "distributionLimit","responseDueAt","createdAt","updatedAt"
    ) VALUES ('bad_limit','SECURITY-2','security_customer','security_category','bad','bad','B1','GBP','OPEN',0,now()+interval '1 day',now(),now());
    RAISE EXCEPTION 'zero distribution limit accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO bridge_ai."SupplierQuotation" (
      id,"quoteRequestId","supplierCompanyId","assignmentId",status,price,currency,"leadTimeDays","submittedAt","createdAt","updatedAt"
    ) VALUES ('bad_state','security_request','security_company_a','security_assignment','SUBMITTED',10,'GBP',1,now(),now(),now());
    RAISE EXCEPTION 'contradictory quotation and assignment state accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO bridge_ai."SupplierQuotation" (
      id,"quoteRequestId","supplierCompanyId","assignmentId",status,price,currency,"leadTimeDays","createdAt","updatedAt"
    ) VALUES ('bad_price','security_request','security_company_a','security_assignment','DRAFT',-1,'GBP',1,now(),now());
    RAISE EXCEPTION 'negative quotation price accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO bridge_ai."Attachment" (
      id,kind,"fileName","mimeType","byteSize","storageKey",sha256,"scanStatus","quoteRequestId","supplierCompanyId","createdAt"
    ) VALUES ('bad_attachment','OTHER','bad','text/plain',-1,'bad','hash','PENDING','security_request','security_company_a',now());
    RAISE EXCEPTION 'invalid attachment size/parent accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  IF has_function_privilege('anon','public.handle_new_user()','EXECUTE')
     OR has_function_privilege('authenticated','public.handle_new_user()','EXECUTE')
     OR has_function_privilege('anon','public.sync_request_quote_count()','EXECUTE') THEN
    RAISE EXCEPTION 'legacy privileged functions remain executable';
  END IF;
END
$test$;

ROLLBACK;
SELECT 'security integration suite passed' AS result;
