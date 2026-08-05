-- Run against a disposable/local Supabase database or inside a transaction on the isolated test project.
-- It uses two existing auth.users identities and rolls back all fixtures.
BEGIN;

DO $test$
DECLARE
  user_a uuid;
  user_b uuid;
  visible_count integer;
  affected_count integer;
  request_deadline timestamptz;
  error_text text;
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
    ('security_company_c','Security Company C','c@bridge.test','3','PENDING',now(),now());
  INSERT INTO bridge_ai.company_memberships (id,"userId","supplierCompanyId",role,status,"isPrimary","joinedAt") VALUES
    ('security_membership_a',user_a,'security_company_a','OWNER','ACTIVE',true,now()),
    ('security_membership_b',user_b,'security_company_b','OWNER','ACTIVE',true,now());
  INSERT INTO bridge_ai."Subscription" (id,"supplierCompanyId",provider,"planCode",status,"currentPeriodStart","currentPeriodEnd","createdAt","updatedAt")
  VALUES ('security_subscription_a','security_company_a','stripe','bridge-ai-monthly','ACTIVE',now(),now()+interval '1 month',now(),now());
  INSERT INTO bridge_ai."Attachment" (id,kind,"fileName","mimeType","byteSize","storageKey",sha256,"scanStatus","supplierCompanyId","uploadedById","createdAt") VALUES
    ('security_accreditation_file_a','ACCREDITATION_DOCUMENT','a.pdf','application/pdf',1,'companies/security_company_a/accreditations/a.pdf','a','CLEAN','security_company_a',user_a,now()),
    ('security_accreditation_file_b','ACCREDITATION_DOCUMENT','b.pdf','application/pdf',1,'companies/security_company_b/accreditations/b.pdf','b','CLEAN','security_company_b',user_b,now());

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);

  INSERT INTO bridge_ai.supplier_accreditations (
    id,"supplierCompanyId","attachmentId",type,"displayName",status,"createdById","createdAt","updatedAt"
  ) VALUES (
    'security_accreditation_a','security_company_a','security_accreditation_file_a','CERTIFICATION','Company A certificate','PENDING',user_a,now(),now()
  );
  BEGIN
    INSERT INTO bridge_ai.supplier_accreditations (
      id,"supplierCompanyId","attachmentId",type,"displayName",status,"createdById","createdAt","updatedAt"
    ) VALUES (
      'forbidden_accreditation_b','security_company_b','security_accreditation_file_b','CERTIFICATION','Company B certificate','PENDING',user_a,now(),now()
    );
    RAISE EXCEPTION 'Supplier A inserted Supplier B accreditation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE bridge_ai.supplier_accreditations
  SET status='APPROVED',"reviewedAt"=now(),"reviewedById"=user_a
  WHERE id='security_accreditation_a';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 0 THEN RAISE EXCEPTION 'Supplier changed protected accreditation review state'; END IF;
  DELETE FROM bridge_ai."Attachment" WHERE id='security_accreditation_file_b';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 0 THEN RAISE EXCEPTION 'Supplier A deleted Supplier B accreditation file'; END IF;
  DELETE FROM bridge_ai."Attachment" WHERE id='security_accreditation_file_a';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 1 THEN RAISE EXCEPTION 'Supplier A could not delete own pending accreditation file'; END IF;
  IF EXISTS (SELECT 1 FROM bridge_ai.supplier_accreditations WHERE id='security_accreditation_a') THEN
    RAISE EXCEPTION 'accreditation metadata did not cascade after file deletion';
  END IF;

  SELECT count(*) INTO visible_count FROM bridge_ai.supplier_companies WHERE id = 'security_company_b';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'Supplier A selected Supplier B company'; END IF;

  UPDATE bridge_ai.supplier_companies SET "legalName"='forbidden' WHERE id='security_company_b';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 0 THEN RAISE EXCEPTION 'Supplier A updated Supplier B company'; END IF;

  BEGIN
    UPDATE bridge_ai.supplier_companies SET status='SUSPENDED' WHERE id='security_company_a';
    RAISE EXCEPTION 'Supplier changed its own protected review state';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO bridge_ai."CoverageArea" (id,"supplierCompanyId",type,label,active,"createdAt","updatedAt")
    VALUES ('forbidden_coverage','security_company_b','NATIONWIDE','forbidden',true,now(),now());
    RAISE EXCEPTION 'Supplier A inserted a Supplier B coverage rule';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO bridge_ai.company_memberships (id,"userId","supplierCompanyId",role,status,"isPrimary","joinedAt")
    VALUES ('forbidden_membership',user_a,'security_company_b','MEMBER','ACTIVE',false,now());
    RAISE EXCEPTION 'Supplier A inserted a Supplier B membership';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO bridge_ai."WebhookEvent" (id,provider,"externalEventId","eventType",payload,"receivedAt","retryCount")
    VALUES ('forbidden_webhook','META_WHATSAPP','forbidden','messages','{}'::jsonb,now(),0);
    RAISE EXCEPTION 'Supplier inserted a trusted webhook event';
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
  BEGIN
    UPDATE bridge_ai.supplier_companies
    SET status='APPROVED',"approvedAt"=now(),"approvedById"=user_a
    WHERE id='security_company_c';
    RAISE EXCEPTION 'Administrator approved an incomplete supplier';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
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

  IF bridge_private.next_supplier_response_start('2026-08-07 15:01 Europe/London'::timestamptz)
       <> '2026-08-10 08:00 Europe/London'::timestamptz THEN
    RAISE EXCEPTION 'Friday response cutoff did not resume Monday at 08:00';
  END IF;
  IF bridge_private.add_supplier_response_hours('2026-08-07 14:00 Europe/London'::timestamptz, 2)
       <> '2026-08-10 09:00 Europe/London'::timestamptz THEN
    RAISE EXCEPTION 'supplier response hours consumed weekend pause time';
  END IF;

  BEGIN
    INSERT INTO bridge_ai.company_memberships (id,"userId","supplierCompanyId",role,status,"isPrimary","joinedAt")
    VALUES ('second_primary',user_a,'security_company_c','MEMBER','ACTIVE',true,now());
    RAISE EXCEPTION 'multiple primary memberships accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO bridge_ai."CustomerContact" (id,"displayNameEncrypted","phoneEncrypted","phoneHash","createdAt","updatedAt")
  VALUES ('security_customer',decode('00','hex'),decode('00','hex'),'security-phone-hash',now(),now());
  INSERT INTO bridge_ai."Conversation" (id,"customerContactId",channel,"externalConversationId","createdAt","updatedAt")
  VALUES ('security_conversation','security_customer','WHATSAPP','wa:security-phone-hash',now(),now());
  INSERT INTO bridge_ai."WhatsAppMessage" (
    id,"conversationId","externalMessageId",direction,"messageType","bodyEncrypted",status,"occurredAt","createdAt"
  ) VALUES (
    'security_message','security_conversation','security-message','INBOUND','TEXT',decode('00','hex'),'RECEIVED',now(),now()
  );
  INSERT INTO bridge_ai."WhatsAppJob" (
    id,type,status,"idempotencyKey","conversationId","whatsappMessageId",attempts,"availableAt","createdAt","updatedAt"
  ) VALUES (
    'security_whatsapp_job','PROCESS_INBOUND','PENDING','security-job','security_conversation','security_message',0,now(),now(),now()
  );
  INSERT INTO bridge_ai."WhatsAppJob" (
    id,type,status,"idempotencyKey","conversationId",attempts,"availableAt","createdAt","updatedAt"
  ) VALUES (
    'security_fallback_job','SEND_INTAKE_FALLBACK','PENDING','security-fallback-job','security_conversation',0,now(),now(),now()
  );
  BEGIN
    UPDATE bridge_ai."Conversation" SET "aiLastQuestionKey"='NOT_A_REAL_QUESTION' WHERE id='security_conversation';
    RAISE EXCEPTION 'invalid WhatsApp AI question state accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE bridge_ai."Conversation" SET "aiUnproductiveTurns"=-1 WHERE id='security_conversation';
    RAISE EXCEPTION 'negative WhatsApp AI loop count accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE bridge_ai.platform_administrators SET active=true WHERE "userId"=user_a;
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
  SELECT count(*) INTO visible_count FROM bridge_ai."WhatsAppJob" WHERE id='security_whatsapp_job';
  IF visible_count <> 1 THEN RAISE EXCEPTION 'Administrator could not inspect a WhatsApp job'; END IF;
  UPDATE bridge_ai."WhatsAppJob"
  SET status='FAILED',"failedAt"=now(),"errorCode"='SECURITY_TEST'
  WHERE id='security_whatsapp_job';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 1 THEN RAISE EXCEPTION 'Administrator could not safely update a WhatsApp job'; END IF;
  UPDATE bridge_ai."WhatsAppJob"
  SET status='PENDING',"failedAt"=NULL,"errorCode"=NULL
  WHERE id='security_whatsapp_job';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE bridge_ai.platform_administrators SET active=false WHERE "userId"=user_a;
  INSERT INTO bridge_ai."ProductCategory" (id,name,slug,active,"displayOrder","createdAt","updatedAt")
  VALUES ('security_category','Security category','security-category',true,0,now(),now());
  request_deadline := bridge_private.add_supplier_response_hours(now(), 24);
  INSERT INTO bridge_ai."QuoteRequest" (
    id,reference,"conversationId","customerContactId","categoryId",title,summary,"deliveryPostcode",currency,status,
    "distributionLimit","responseDueAt","createdAt","updatedAt"
  ) VALUES (
    'security_request','SECURITY-1','security_conversation','security_customer','security_category','Test','Test','B1','GBP','OPEN',
    1,request_deadline,now(),now()
  );
  INSERT INTO bridge_ai."QuoteRequest" (
    id,reference,"conversationId","customerContactId","categoryId",title,summary,"deliveryPostcode",currency,status,
    "distributionLimit","responseDueAt","createdAt","updatedAt"
  ) VALUES (
    'security_request_supplier_denied','SECURITY-SUPPLIER-DENIED','security_conversation','security_customer','security_category','Denied','Denied','B1','GBP','OPEN',
    1,request_deadline,now(),now()
  );
  UPDATE bridge_ai."QuoteRequest"
  SET "customerConfirmationMessageId"='security_message'
  WHERE id='security_request';
  BEGIN
    INSERT INTO bridge_ai."QuoteRequest" (
      id,reference,"customerConfirmationMessageId","customerContactId","categoryId",title,summary,"deliveryPostcode",currency,status,
      "distributionLimit","responseDueAt","createdAt","updatedAt"
    ) VALUES (
      'duplicate_confirmation','SECURITY-DUPLICATE','security_message','security_customer','security_category','Duplicate','Duplicate','B1','GBP','OPEN',
      1,request_deadline,now(),now()
    );
    RAISE EXCEPTION 'one WhatsApp confirmation published more than one quote request';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO bridge_ai."SupplierAssignment" (
    id,"quoteRequestId","supplierCompanyId",status,"assignedAt","expiresAt"
  ) VALUES ('security_assignment','security_request','security_company_a','PENDING',now(),request_deadline);

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
  SELECT count(*) INTO visible_count FROM bridge_ai."CustomerContact" WHERE id='security_customer';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'Supplier selected encrypted customer identity'; END IF;
  SELECT count(*) INTO visible_count FROM bridge_ai."WhatsAppMessage" WHERE id='security_message';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'Supplier selected private WhatsApp message'; END IF;
  SELECT count(*) INTO visible_count FROM bridge_ai."WhatsAppJob" WHERE "conversationId"='security_conversation';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'Supplier selected private WhatsApp processing or fallback state'; END IF;
  SELECT count(*) INTO visible_count FROM bridge_ai."SupplierOpportunity"
  WHERE "quoteRequestId"='security_request_supplier_denied';
  IF visible_count <> 1 THEN RAISE EXCEPTION 'Approved supplier could not browse safe opportunity projection'; END IF;
  SELECT count(*) INTO visible_count FROM bridge_ai."QuoteRequest"
  WHERE id='security_request_supplier_denied';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'Opportunity browsing exposed the private quote request row'; END IF;
  BEGIN
    UPDATE bridge_ai."SupplierOpportunity" SET title='forbidden'
    WHERE "quoteRequestId"='security_request_supplier_denied';
    RAISE EXCEPTION 'Supplier changed the opportunity projection';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', user_b::text, true);
  SELECT count(*) INTO visible_count FROM bridge_ai."SupplierOpportunity"
  WHERE "quoteRequestId"='security_request_supplier_denied';
  IF visible_count <> 1 THEN RAISE EXCEPTION 'Approved non-subscriber could not browse an opportunity'; END IF;
  BEGIN
    PERFORM bridge_private.claim_supplier_opportunity('SECURITY-SUPPLIER-DENIED','security_company_b');
    RAISE EXCEPTION 'Authenticated client directly executed server-only opportunity claim';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
  BEGIN
    INSERT INTO bridge_ai."SupplierAssignment" (
      id,"quoteRequestId","supplierCompanyId",status,"assignedAt","expiresAt"
    ) VALUES ('forbidden_supplier_assignment','security_request_supplier_denied','security_company_a','PENDING',now(),request_deadline);
    RAISE EXCEPTION 'Supplier created its own request assignment';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE bridge_ai."Conversation"
  SET "aiSessionStartedAt" = now()
  WHERE id='security_conversation';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 0 THEN RAISE EXCEPTION 'Supplier changed a customer WhatsApp quote session'; END IF;
  BEGIN
    INSERT INTO bridge_ai."WhatsAppJob" (
      id,type,status,"idempotencyKey","conversationId","whatsappMessageId",attempts,"availableAt","createdAt","updatedAt"
    ) VALUES ('forbidden_whatsapp_job','PROCESS_INBOUND','PENDING','forbidden-job','security_conversation','security_message',0,now(),now(),now());
    RAISE EXCEPTION 'Supplier inserted a WhatsApp AI job';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);

  BEGIN
    INSERT INTO bridge_ai."QuoteRequestItem" (id,"quoteRequestId",description,quantity,unit,"displayOrder","createdAt")
    VALUES ('bad_quantity','security_request','bad',0,'each',0,now());
    RAISE EXCEPTION 'zero quantity accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO bridge_ai."CoverageArea" (id,"supplierCompanyId",type,label,"centrePostcode","radiusMiles",latitude,longitude,active,"createdAt","updatedAt")
    VALUES ('bad_radius','security_company_a','DISTANCE','bad','B1 1AA',-1,52.479699,-1.902691,true,now(),now());
    RAISE EXCEPTION 'negative coverage radius accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO bridge_ai."CoverageArea" (id,"supplierCompanyId",type,label,"centrePostcode","radiusMiles",active,"createdAt","updatedAt")
    VALUES ('missing_coordinates','security_company_a','DISTANCE','missing','B1 1AA',40,true,now(),now());
    RAISE EXCEPTION 'distance coverage without coordinates accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO bridge_ai."CoverageArea" (id,"supplierCompanyId",type,label,active,"createdAt","updatedAt")
  VALUES ('valid_nationwide','security_company_a','NATIONWIDE','UK',true,now(),now());
  BEGIN
    INSERT INTO bridge_ai."CoverageArea" (id,"supplierCompanyId",type,label,"radiusMiles",active,"createdAt","updatedAt")
    VALUES ('bad_nationwide','security_company_b','NATIONWIDE','bad',40,true,now(),now());
    RAISE EXCEPTION 'nationwide coverage with radius accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO bridge_ai."CoverageArea" (id,"supplierCompanyId",type,label,active,"createdAt","updatedAt")
    VALUES ('duplicate_nationwide','security_company_a','NATIONWIDE','duplicate',true,now(),now());
    RAISE EXCEPTION 'duplicate active nationwide coverage accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO bridge_ai."QuoteRequest" (
      id,reference,"customerContactId","categoryId",title,summary,"deliveryPostcode",currency,status,
      "distributionLimit","responseDueAt","createdAt","updatedAt"
    ) VALUES ('bad_limit','SECURITY-2','security_customer','security_category','bad','bad','B1','GBP','OPEN',0,request_deadline,now(),now());
    RAISE EXCEPTION 'zero distribution limit accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO bridge_ai."QuoteRequest" (
      id,reference,"customerContactId","categoryId",title,summary,"deliveryPostcode",currency,status,
      "distributionLimit","responseDueAt","createdAt","updatedAt"
    ) VALUES ('bad_high_limit','SECURITY-3','security_customer','security_category','bad','bad','B1','GBP','OPEN',6,request_deadline,now(),now());
    RAISE EXCEPTION 'distribution limit above five accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO bridge_ai."QuoteRequest" (
      id,reference,"customerContactId","categoryId",title,summary,"deliveryPostcode",currency,status,
      "distributionLimit","responseDueAt","createdAt","updatedAt"
    ) VALUES (
      'bad_weekend_deadline','SECURITY-4','security_customer','security_category','bad','bad','B1','GBP','OPEN',1,
      (date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '12 days 12 hours') AT TIME ZONE 'Europe/London',now(),now()
    );
    RAISE EXCEPTION 'weekend response deadline accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO bridge_ai."SupplierAssignment" (
      id,"quoteRequestId","supplierCompanyId",status,"assignedAt","expiresAt"
    ) VALUES ('bad_assignment_deadline','security_request','security_company_b','PENDING',now(),request_deadline + interval '1 hour');
    SET CONSTRAINTS assignment_response_deadline_matches_request IMMEDIATE;
    RAISE EXCEPTION 'assignment-specific response deadline accepted';
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

  UPDATE bridge_ai."Conversation" conversation
  SET "aiSessionStartedAt" = message."occurredAt"
  FROM bridge_ai."WhatsAppMessage" message
  WHERE conversation.id='security_conversation'
    AND message.id='security_message';
  INSERT INTO bridge_ai."Attachment" (
    id,kind,"fileName","mimeType","byteSize","storageKey",sha256,"scanStatus","whatsappMessageId","quoteRequestId","createdAt"
  ) VALUES (
    'security_whatsapp_quote_attachment','PHOTO','customer.jpg','image/jpeg',12,'whatsapp/security/customer.jpg','customer-hash','CLEAN','security_message','security_request',now()
  );
  INSERT INTO bridge_ai."WhatsAppMessage" (
    id,"conversationId","externalMessageId",direction,"messageType",status,"occurredAt","createdAt"
  ) VALUES (
    'security_old_message','security_conversation','security-old-message','INBOUND','IMAGE','RECEIVED',
    (SELECT "aiSessionStartedAt" - interval '1 second' FROM bridge_ai."Conversation" WHERE id='security_conversation'),now()
  );
  BEGIN
    INSERT INTO bridge_ai."Attachment" (
      id,kind,"fileName","mimeType","byteSize","storageKey",sha256,"scanStatus","whatsappMessageId","quoteRequestId","createdAt"
    ) VALUES (
      'security_old_quote_attachment','PHOTO','old.jpg','image/jpeg',12,'whatsapp/security/old.jpg','old-hash','CLEAN','security_old_message','security_request',now()
    );
    RAISE EXCEPTION 'Attachment from an older WhatsApp intake session linked to a new request';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO bridge_ai."QuoteRequest" (
    id,reference,"conversationId","customerContactId","categoryId",title,summary,"deliveryPostcode",currency,status,
    "distributionLimit","responseDueAt","createdAt","updatedAt"
  ) VALUES (
    'security_request_auto','SECURITY-AUTO','security_conversation','security_customer','security_category','Automatic','Automatic','B1','GBP','OPEN',
    1,request_deadline,now(),now()
  );

  INSERT INTO bridge_ai."SupplierProductCategory" ("supplierCompanyId","productCategoryId","createdAt")
  VALUES ('security_company_a','security_category',now());
  INSERT INTO bridge_ai."Attachment" (
    id,kind,"fileName","mimeType","byteSize","storageKey",sha256,"scanStatus","supplierCompanyId","uploadedById","createdAt"
  ) VALUES (
    'security_claim_accreditation_file','ACCREDITATION_DOCUMENT','claim.pdf','application/pdf',12,
    'companies/security_company_a/accreditations/claim.pdf','claim-hash','CLEAN','security_company_a',user_a,now()
  );
  INSERT INTO bridge_ai.supplier_accreditations (
    id,"supplierCompanyId","attachmentId",type,"displayName",status,"reviewedAt","reviewedById","createdById","createdAt","updatedAt"
  ) VALUES (
    'security_claim_accreditation','security_company_a','security_claim_accreditation_file','CERTIFICATION',
    'Claim certificate','APPROVED',now(),user_a,user_a,now(),now()
  );

  PERFORM set_config('request.jwt.claim.sub', user_b::text, true);
  BEGIN
    PERFORM bridge_private.claim_supplier_opportunity('SECURITY-AUTO','security_company_a');
    RAISE EXCEPTION 'Supplier B claimed an opportunity for Supplier A';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM bridge_private.claim_supplier_opportunity('SECURITY-AUTO','security_company_b');
    RAISE EXCEPTION 'Non-subscriber claimed an opportunity';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS error_text = MESSAGE_TEXT;
    IF error_text <> 'ACTIVE_SUBSCRIPTION_REQUIRED' THEN
      RAISE EXCEPTION 'Unexpected non-subscriber claim failure: %', error_text;
    END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
  PERFORM bridge_private.claim_supplier_opportunity('SECURITY-AUTO','security_company_a');
  IF NOT EXISTS (
    SELECT 1 FROM bridge_ai."SupplierAssignment"
    WHERE "quoteRequestId"='security_request_auto'
      AND "supplierCompanyId"='security_company_a'
      AND status='ACCEPTED'
  ) THEN RAISE EXCEPTION 'Eligible subscriber claim did not create an accepted assignment'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM bridge_ai."AuditLog"
    WHERE action='OPPORTUNITY.CLAIMED'
      AND "supplierCompanyId"='security_company_a'
      AND metadata->>'quoteRequestId'='security_request_auto'
  ) THEN RAISE EXCEPTION 'Opportunity claim audit record is missing'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  UPDATE bridge_ai."SupplierAssignment" SET status='ACCEPTED',"respondedAt"=now() WHERE id='security_assignment';
  INSERT INTO bridge_ai."SupplierQuotation" (
    id,"quoteRequestId","supplierCompanyId","assignmentId",status,price,currency,"leadTimeDays","submittedAt","createdAt","updatedAt"
  ) VALUES ('security_quote','security_request','security_company_a','security_assignment','SUBMITTED',125,'GBP',7,now(),now(),now());
  UPDATE bridge_ai."SupplierAssignment" SET status='QUOTED' WHERE id='security_assignment';
  INSERT INTO bridge_ai."SupplierSuccessFee" (
    id,"quotationId","quoteRequestId","supplierCompanyId","amountPence",currency,status,provider,"selectedAt","paymentDueAt","createdAt","updatedAt"
  ) VALUES (
    'security_fee','security_quote','security_request','security_company_a',2500,'GBP','PENDING','stripe',now(),
    bridge_private.add_supplier_response_hours(now(),2),now(),now()
  );
  PERFORM set_config('bridge_ai.payment_transition','on',true);
  UPDATE bridge_ai."SupplierQuotation" SET status='SELECTED_PENDING_PAYMENT',"decidedAt"=now() WHERE id='security_quote';
  PERFORM set_config('bridge_ai.payment_transition','',true);

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
  SELECT count(*) INTO visible_count FROM bridge_ai."SupplierSuccessFee" WHERE id='security_fee';
  IF visible_count <> 1 THEN RAISE EXCEPTION 'Supplier could not read own success fee'; END IF;
  BEGIN
    UPDATE bridge_ai."SupplierQuotation" SET status='ACCEPTED' WHERE id='security_quote';
    RAISE EXCEPTION 'Supplier marked its own quote as accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO bridge_ai."ContactAccessGrant" (
      id,"successFeeId","quotationId","customerContactId","supplierCompanyId","createdAt"
    ) VALUES ('forbidden_grant','security_fee','security_quote','security_customer','security_company_a',now());
    RAISE EXCEPTION 'Supplier inserted its own contact access grant';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', user_b::text, true);
  SELECT count(*) INTO visible_count FROM bridge_ai."SupplierSuccessFee" WHERE id='security_fee';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'Supplier B read Supplier A success fee'; END IF;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);

  UPDATE bridge_ai."SupplierSuccessFee" SET status='PAID',"providerPaymentIntentId"='pi_security',"paidAt"=now(),"unlockedAt"=now(),"updatedAt"=now()
  WHERE id='security_fee';
  INSERT INTO bridge_ai."ContactAccessGrant" (
    id,"successFeeId","quotationId","customerContactId","supplierCompanyId","createdAt"
  ) VALUES ('security_grant','security_fee','security_quote','security_customer','security_company_a',now());
  PERFORM set_config('bridge_ai.payment_transition','on',true);
  UPDATE bridge_ai."SupplierQuotation" SET status='ACCEPTED' WHERE id='security_quote';
  PERFORM set_config('bridge_ai.payment_transition','',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
  SELECT count(*) INTO visible_count FROM bridge_ai."ContactAccessGrant" WHERE id='security_grant';
  IF visible_count <> 1 THEN RAISE EXCEPTION 'Paid supplier could not read its contact grant'; END IF;
  SELECT count(*) INTO visible_count FROM bridge_ai."CustomerContact" WHERE id='security_customer';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'Contact grant exposed encrypted customer row through the Data API'; END IF;
  PERFORM set_config('request.jwt.claim.sub', user_b::text, true);
  SELECT count(*) INTO visible_count FROM bridge_ai."ContactAccessGrant" WHERE id='security_grant';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'Supplier B read Supplier A contact grant'; END IF;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF has_function_privilege('anon','public.handle_new_user()','EXECUTE')
     OR has_function_privilege('authenticated','public.handle_new_user()','EXECUTE')
     OR has_function_privilege('anon','public.sync_request_quote_count()','EXECUTE')
     OR has_function_privilege('authenticated','bridge_private.next_supplier_response_start(timestamptz)','EXECUTE')
     OR has_function_privilege('authenticated','bridge_private.add_supplier_response_hours(timestamptz,integer)','EXECUTE')
     OR has_function_privilege('authenticated','bridge_private.write_whatsapp_system_event(bridge_ai."SystemEventSeverity",text,text,text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','bridge_private.claim_supplier_opportunity(text,text)','EXECUTE')
     OR NOT has_function_privilege('bridge_ai_app','bridge_private.write_whatsapp_system_event(bridge_ai."SystemEventSeverity",text,text,text,jsonb)','EXECUTE')
     OR NOT has_function_privilege('bridge_ai_app','bridge_private.claim_supplier_opportunity(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'legacy privileged functions remain executable';
  END IF;
  SELECT count(*) INTO visible_count
  FROM pg_policies
  WHERE schemaname='bridge_ai'
    AND policyname IN (
      'whatsapp_ai_membership_match_select',
      'whatsapp_ai_supplier_category_match_select',
      'whatsapp_ai_coverage_match_select',
      'whatsapp_ai_accreditation_match_select',
      'whatsapp_ai_subscription_match_select',
      'whatsapp_ai_assignment_insert',
      'whatsapp_ai_notification_insert',
      'whatsapp_ai_notification_preference_select'
    )
    AND roles @> ARRAY['authenticated']::name[];
  IF visible_count <> 8 THEN
    RAISE EXCEPTION 'trusted WhatsApp matching policies are incomplete';
  END IF;
END
$test$;

ROLLBACK;
SELECT 'security integration suite passed' AS result;
