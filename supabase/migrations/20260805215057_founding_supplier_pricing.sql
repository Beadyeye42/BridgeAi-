-- Founding supplier pricing is available to the first 100 companies approved
-- by a platform administrator. The number is allocated transactionally and is
-- never recycled by suspension or rejection.
ALTER TABLE bridge_ai.supplier_companies
  ADD COLUMN "foundingMemberNumber" integer;

ALTER TABLE bridge_ai.supplier_companies
  ADD CONSTRAINT supplier_companies_founding_member_number_range
  CHECK ("foundingMemberNumber" IS NULL OR "foundingMemberNumber" BETWEEN 1 AND 100);

CREATE UNIQUE INDEX supplier_companies_founding_member_number_key
  ON bridge_ai.supplier_companies ("foundingMemberNumber");

DO $$
BEGIN
  IF (SELECT count(*) FROM bridge_ai.supplier_companies WHERE status = 'APPROVED') > 100 THEN
    RAISE EXCEPTION 'More than 100 suppliers are already approved; founding places cannot be allocated safely';
  END IF;
END;
$$;

WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY "approvedAt" NULLS LAST, "createdAt", id)::integer AS place
  FROM bridge_ai.supplier_companies
  WHERE status = 'APPROVED'
)
UPDATE bridge_ai.supplier_companies company
SET "foundingMemberNumber" = ranked.place
FROM ranked
WHERE company.id = ranked.id;

CREATE OR REPLACE FUNCTION bridge_private.allocate_founding_supplier_place()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE next_place integer;
BEGIN
  IF NEW."foundingMemberNumber" IS DISTINCT FROM OLD."foundingMemberNumber" THEN
    RAISE EXCEPTION 'founding supplier place is server controlled' USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'APPROVED'
     AND OLD.status IS DISTINCT FROM 'APPROVED'
     AND OLD."foundingMemberNumber" IS NULL THEN
    PERFORM pg_advisory_xact_lock(2147483001);
    SELECT coalesce(max("foundingMemberNumber"), 0) + 1
      INTO next_place
      FROM bridge_ai.supplier_companies;
    IF next_place > 100 THEN
      RAISE EXCEPTION 'FOUNDING_SUPPLIER_CAPACITY_REACHED' USING ERRCODE = 'P0001';
    END IF;
    NEW."foundingMemberNumber" := next_place;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.allocate_founding_supplier_place()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER allocate_founding_supplier_place
  BEFORE UPDATE OF status, "foundingMemberNumber" ON bridge_ai.supplier_companies
  FOR EACH ROW EXECUTE FUNCTION bridge_private.allocate_founding_supplier_place();

-- Store the Stripe schedule which moves a founding member from £29.99 + VAT
-- to £49.99 + VAT after six monthly billing periods.
ALTER TABLE bridge_ai."Subscription"
  ADD COLUMN "providerScheduleId" text;

CREATE UNIQUE INDEX "Subscription_providerScheduleId_key"
  ON bridge_ai."Subscription" ("providerScheduleId");

-- Winning fees are retired. Existing fee rows remain as immutable history,
-- while new customer selections grant contact access directly.
ALTER TABLE bridge_ai."ContactAccessGrant"
  ALTER COLUMN "successFeeId" DROP NOT NULL,
  ALTER COLUMN reason SET DEFAULT 'CUSTOMER_SELECTED';

ALTER TABLE bridge_ai."ContactAccessGrant"
  DROP CONSTRAINT contact_access_reason,
  ADD CONSTRAINT contact_access_reason CHECK (
    (reason = 'CUSTOMER_SELECTED' AND "successFeeId" IS NULL)
    OR (reason = 'SUCCESS_FEE_PAID' AND "successFeeId" IS NOT NULL)
  );

DROP POLICY IF EXISTS success_fee_company_read ON bridge_ai."SupplierSuccessFee";

CREATE OR REPLACE FUNCTION bridge_private.enforce_contact_access_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE fee_row bridge_ai."SupplierSuccessFee"%ROWTYPE;
DECLARE quotation_row bridge_ai."SupplierQuotation"%ROWTYPE;
DECLARE request_customer_id text;
BEGIN
  SELECT * INTO quotation_row FROM bridge_ai."SupplierQuotation" WHERE id = NEW."quotationId";
  SELECT "customerContactId" INTO request_customer_id
  FROM bridge_ai."QuoteRequest" WHERE id = quotation_row."quoteRequestId";

  IF quotation_row.id IS NULL
    OR quotation_row."supplierCompanyId" <> NEW."supplierCompanyId"
    OR request_customer_id <> NEW."customerContactId" THEN
    RAISE EXCEPTION 'contact access does not match quotation tenant and customer' USING ERRCODE = '23514';
  END IF;

  IF NEW.reason = 'SUCCESS_FEE_PAID' THEN
    SELECT * INTO fee_row FROM bridge_ai."SupplierSuccessFee" WHERE id = NEW."successFeeId";
    IF fee_row.id IS NULL OR fee_row.status <> 'PAID' OR fee_row."unlockedAt" IS NULL
      OR fee_row."quotationId" <> NEW."quotationId"
      OR fee_row."supplierCompanyId" <> NEW."supplierCompanyId" THEN
      RAISE EXCEPTION 'historical contact access requires a matching paid success fee' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION bridge_private.enforce_payment_gated_quotation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'SUBMITTED' AND (OLD.status IS DISTINCT FROM NEW.status) AND NOT EXISTS (
    SELECT 1
    FROM bridge_ai.supplier_companies company
    JOIN bridge_ai."Subscription" subscription
      ON subscription."supplierCompanyId" = company.id
    WHERE company.id = NEW."supplierCompanyId"
      AND company.status = 'APPROVED'
      AND company."foundingMemberNumber" BETWEEN 1 AND 100
      AND subscription.status = 'ACTIVE'
      AND (subscription."currentPeriodEnd" IS NULL OR subscription."currentPeriodEnd" > now())
  ) THEN
    RAISE EXCEPTION 'an active founding supplier membership is required to submit a quotation' USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('SELECTED_PENDING_PAYMENT', 'ACCEPTED')
    AND OLD.status IS DISTINCT FROM NEW.status
    AND NOT bridge_private.is_platform_admin()
    AND coalesce(current_setting('bridge_ai.payment_transition', true), '') <> 'on' THEN
    RAISE EXCEPTION 'customer selection transitions are server controlled' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION bridge_private.validate_payment_gated_quotation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'SELECTED_PENDING_PAYMENT' AND NOT EXISTS (
    SELECT 1 FROM bridge_ai."SupplierSuccessFee" fee
    WHERE fee."quotationId" = NEW.id
      AND fee.status IN ('PENDING', 'CHECKOUT_CREATED')
  ) THEN
    RAISE EXCEPTION 'legacy selected quotation requires a pending success fee' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'ACCEPTED' AND NOT EXISTS (
    SELECT 1 FROM bridge_ai."ContactAccessGrant" grant_row
    WHERE grant_row."quotationId" = NEW.id
      AND grant_row."supplierCompanyId" = NEW."supplierCompanyId"
      AND grant_row."revokedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'accepted quotation requires a matching contact grant' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON COLUMN bridge_ai.supplier_companies."foundingMemberNumber" IS
  'Immutable approval order for the first 100 founding suppliers.';
COMMENT ON COLUMN bridge_ai."Subscription"."providerScheduleId" IS
  'Stripe schedule controlling the six-month introductory price transition.';

-- Claiming an opportunity is a privileged, transactional operation. Repeat
-- every existing eligibility check here and add the immutable founding-place
-- requirement so the application cannot bypass the 100-supplier limit.
CREATE OR REPLACE FUNCTION bridge_private.claim_supplier_opportunity(
  target_reference text,
  target_company_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := (SELECT auth.uid());
  request_row bridge_ai."QuoteRequest"%ROWTYPE;
  assignment_id text := 'claim_' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF actor_id IS NULL OR NOT bridge_private.has_company_membership(target_company_id) THEN
    RAISE EXCEPTION 'CLAIM_NOT_AUTHORISED' USING ERRCODE = '42501';
  END IF;

  SELECT request.* INTO request_row
  FROM bridge_ai."QuoteRequest" request
  JOIN bridge_ai."SupplierOpportunity" opportunity ON opportunity."quoteRequestId" = request.id
  WHERE opportunity.reference = target_reference
  FOR UPDATE OF request;

  IF request_row.id IS NULL THEN
    RAISE EXCEPTION 'OPPORTUNITY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF request_row.status NOT IN ('OPEN', 'MATCHING', 'QUOTED') OR request_row."responseDueAt" <= now() THEN
    RAISE EXCEPTION 'OPPORTUNITY_CLOSED' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bridge_ai."SupplierAssignment" assignment
    WHERE assignment."quoteRequestId" = request_row.id
      AND assignment."supplierCompanyId" = target_company_id
  ) THEN
    SELECT assignment.id INTO assignment_id
    FROM bridge_ai."SupplierAssignment" assignment
    WHERE assignment."quoteRequestId" = request_row.id
      AND assignment."supplierCompanyId" = target_company_id;
    RETURN assignment_id;
  END IF;
  IF (SELECT count(*) FROM bridge_ai."SupplierAssignment" assignment
      WHERE assignment."quoteRequestId" = request_row.id AND assignment.status <> 'WITHDRAWN') >= LEAST(request_row."distributionLimit", 5) THEN
    RAISE EXCEPTION 'OPPORTUNITY_FULL' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM bridge_ai.supplier_companies company
    JOIN bridge_ai."Subscription" subscription ON subscription."supplierCompanyId" = company.id
    WHERE company.id = target_company_id
      AND company.status = 'APPROVED'
      AND company."foundingMemberNumber" BETWEEN 1 AND 100
      AND subscription.status = 'ACTIVE'
      AND (subscription."currentPeriodEnd" IS NULL OR subscription."currentPeriodEnd" > now())
  ) THEN
    RAISE EXCEPTION 'ACTIVE_FOUNDING_SUBSCRIPTION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM bridge_ai."SupplierProductCategory" category
    WHERE category."supplierCompanyId" = target_company_id
      AND category."productCategoryId" = request_row."categoryId"
  ) THEN
    RAISE EXCEPTION 'CATEGORY_NOT_MATCHED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM bridge_ai."CoverageArea" coverage
    WHERE coverage."supplierCompanyId" = target_company_id
      AND coverage.active
      AND (
        coverage.type = 'NATIONWIDE'
        OR (
          coverage.type = 'POSTCODE'
          AND upper(regexp_replace(request_row."deliveryPostcode", '\\s', '', 'g'))
              LIKE upper(regexp_replace(coverage."postcodePrefix", '\\s', '', 'g')) || '%'
        )
        OR (
          coverage.type = 'DISTANCE'
          AND request_row."deliveryLatitude" IS NOT NULL
          AND request_row."deliveryLongitude" IS NOT NULL
          AND coverage.latitude IS NOT NULL
          AND coverage.longitude IS NOT NULL
          AND coverage."radiusMiles" IS NOT NULL
          AND 3958.7613 * acos(least(1, greatest(-1,
            sin(radians(coverage.latitude::double precision)) * sin(radians(request_row."deliveryLatitude"::double precision))
            + cos(radians(coverage.latitude::double precision)) * cos(radians(request_row."deliveryLatitude"::double precision))
            * cos(radians(request_row."deliveryLongitude"::double precision - coverage.longitude::double precision))
          ))) <= coverage."radiusMiles"
        )
      )
  ) THEN
    RAISE EXCEPTION 'COVERAGE_NOT_MATCHED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO bridge_ai."SupplierAssignment" (
    id, "quoteRequestId", "supplierCompanyId", status,
    "assignedAt", "expiresAt", "assignedById"
  ) VALUES (
    assignment_id, request_row.id, target_company_id, 'ACCEPTED',
    now(), request_row."responseDueAt", actor_id
  );
  UPDATE bridge_ai."QuoteRequest"
  SET status = 'MATCHING', "updatedAt" = now()
  WHERE id = request_row.id AND status = 'OPEN';
  INSERT INTO bridge_ai."AuditLog" (
    id, "actorUserId", "supplierCompanyId", action, "entityType",
    "entityId", summary, metadata, "createdAt"
  ) VALUES (
    'audit_' || replace(gen_random_uuid()::text, '-', ''),
    actor_id, target_company_id, 'OPPORTUNITY.CLAIMED',
    'SupplierAssignment', assignment_id,
    'Subscribed founding supplier claimed an opportunity slot',
    jsonb_build_object('quoteRequestId', request_row.id, 'reference', request_row.reference),
    now()
  );
  RETURN assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.claim_supplier_opportunity(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridge_ai_app') THEN
    GRANT EXECUTE ON FUNCTION bridge_private.claim_supplier_opportunity(text, text)
      TO bridge_ai_app;
  END IF;
END
$$;
