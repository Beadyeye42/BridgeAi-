-- Serialize rate-limit reservations before the application generates a bearer link.
CREATE OR REPLACE FUNCTION bridge_private.limit_buyer_login_challenges()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Network first, then customer: every caller uses the same lock ordering.
  IF NEW."requestIpHash" IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('buyer-network:' || NEW."requestIpHash", 0));
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('buyer-customer:' || NEW."customerContactId", 0));
  NEW."createdAt" := clock_timestamp();
  IF (SELECT count(*) FROM bridge_ai."BuyerLoginChallenge" WHERE "customerContactId"=NEW."customerContactId" AND "createdAt">=NEW."createdAt"-interval '1 hour') >= 5
    OR (NEW."requestIpHash" IS NOT NULL AND (SELECT count(*) FROM bridge_ai."BuyerLoginChallenge" WHERE "requestIpHash"=NEW."requestIpHash" AND "createdAt">=NEW."createdAt"-interval '1 hour') >= 12) THEN
    RAISE EXCEPTION 'BUYER_LOGIN_RATE_LIMITED' USING ERRCODE='23514';
  END IF;
  INSERT INTO bridge_ai."AuditLog" (id,action,"entityType","entityId",summary,"createdAt")
  VALUES (gen_random_uuid()::text,'BUYER.LOGIN_RESERVED','BuyerLoginChallenge',NEW.id,'Buyer login request reserved within hourly limits',now());
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.limit_buyer_login_challenges() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER buyer_login_challenge_rate_limit BEFORE INSERT ON bridge_ai."BuyerLoginChallenge"
FOR EACH ROW EXECUTE FUNCTION bridge_private.limit_buyer_login_challenges();

-- Invoked only by version insertion, already protected by quotation ownership RLS.
-- The restricted trigger writes only the job belonging to that exact quotation.
CREATE OR REPLACE FUNCTION bridge_private.queue_quotation_version_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE quote_record record; job_key text; inserted_id text;
BEGIN
  SELECT q.id, q."quoteRequestId", q."supplierCompanyId", r."conversationId" INTO quote_record
  FROM bridge_ai."SupplierQuotation" q JOIN bridge_ai."QuoteRequest" r ON r.id=q."quoteRequestId"
  WHERE q.id=NEW."quotationId" AND q.status='SUBMITTED';
  IF quote_record."conversationId" IS NULL THEN RETURN NEW; END IF;
  job_key := 'quote-summary:' || quote_record."quoteRequestId" || ':quotation:' || NEW."quotationId";
  IF NEW."versionNumber">1 THEN job_key := job_key || ':version:' || NEW."versionNumber"; END IF;
  INSERT INTO bridge_ai."WhatsAppJob" (id,type,"idempotencyKey","conversationId","quoteRequestId","quotationId","updatedAt")
  VALUES (gen_random_uuid()::text,'SEND_QUOTE_SUMMARY',job_key,quote_record."conversationId",quote_record."quoteRequestId",NEW."quotationId",now())
  ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN
    INSERT INTO bridge_ai."AuditLog" (id,"actorUserId","supplierCompanyId",action,"entityType","entityId",summary,metadata,"createdAt")
    VALUES (gen_random_uuid()::text,NEW."submittedById",quote_record."supplierCompanyId",'QUOTATION.NOTIFICATION_QUEUED','SupplierQuotation',NEW."quotationId",'Quotation notification queued with its revision',jsonb_build_object('versionNumber',NEW."versionNumber"),now());
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.queue_quotation_version_notification() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER quotation_version_notification AFTER INSERT ON bridge_ai."QuotationVersion"
FOR EACH ROW EXECUTE FUNCTION bridge_private.queue_quotation_version_notification();
INSERT INTO bridge_ai."AuditLog" (id,action,"entityType",summary,"createdAt")
VALUES ('security_reliability_20260907003207','SYSTEM.SECURITY_RELIABILITY_ENABLED','Migration','Atomic buyer login limits and quotation notification persistence enabled',now());
