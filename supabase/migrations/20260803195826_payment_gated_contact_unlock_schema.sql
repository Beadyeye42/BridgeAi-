CREATE TYPE bridge_ai."SuccessFeeStatus" AS ENUM (
  'PENDING',
  'CHECKOUT_CREATED',
  'PAID',
  'EXPIRED',
  'REFUNDED',
  'DISPUTED'
);

CREATE TABLE bridge_ai."SupplierSuccessFee" (
  id text PRIMARY KEY,
  "quotationId" text NOT NULL UNIQUE,
  "quoteRequestId" text NOT NULL,
  "supplierCompanyId" text NOT NULL,
  "amountPence" integer NOT NULL DEFAULT 2500,
  currency varchar(3) NOT NULL DEFAULT 'GBP',
  status bridge_ai."SuccessFeeStatus" NOT NULL DEFAULT 'PENDING',
  provider text NOT NULL DEFAULT 'stripe',
  "providerCheckoutSessionId" text UNIQUE,
  "providerPaymentIntentId" text UNIQUE,
  "checkoutAttempt" integer NOT NULL DEFAULT 0,
  "selectedAt" timestamptz NOT NULL DEFAULT now(),
  "paymentDueAt" timestamptz NOT NULL,
  "paidAt" timestamptz,
  "unlockedAt" timestamptz,
  "expiredAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL,
  CONSTRAINT success_fee_quotation_fk FOREIGN KEY ("quotationId")
    REFERENCES bridge_ai."SupplierQuotation"(id) ON DELETE RESTRICT,
  CONSTRAINT success_fee_request_fk FOREIGN KEY ("quoteRequestId")
    REFERENCES bridge_ai."QuoteRequest"(id) ON DELETE RESTRICT,
  CONSTRAINT success_fee_company_fk FOREIGN KEY ("supplierCompanyId")
    REFERENCES bridge_ai.supplier_companies(id) ON DELETE RESTRICT,
  CONSTRAINT success_fee_v1_amount CHECK ("amountPence" = 2500 AND currency = 'GBP'),
  CONSTRAINT success_fee_provider CHECK (provider = 'stripe'),
  CONSTRAINT success_fee_attempt_nonnegative CHECK ("checkoutAttempt" >= 0),
  CONSTRAINT success_fee_deadline_sequence CHECK ("paymentDueAt" > "selectedAt"),
  CONSTRAINT success_fee_status_timestamps CHECK (
    (status IN ('PENDING', 'CHECKOUT_CREATED') AND "paidAt" IS NULL AND "unlockedAt" IS NULL AND "expiredAt" IS NULL)
    OR (status = 'PAID' AND "providerPaymentIntentId" IS NOT NULL AND "paidAt" IS NOT NULL AND "unlockedAt" IS NOT NULL AND "expiredAt" IS NULL)
    OR (status = 'EXPIRED' AND "paidAt" IS NULL AND "unlockedAt" IS NULL AND "expiredAt" IS NOT NULL)
    OR (status IN ('REFUNDED', 'DISPUTED') AND "providerPaymentIntentId" IS NOT NULL AND "paidAt" IS NOT NULL)
  )
);

CREATE INDEX "SupplierSuccessFee_supplierCompanyId_status_paymentDueAt_idx"
  ON bridge_ai."SupplierSuccessFee" ("supplierCompanyId", status, "paymentDueAt");
CREATE INDEX "SupplierSuccessFee_quoteRequestId_status_idx"
  ON bridge_ai."SupplierSuccessFee" ("quoteRequestId", status);

CREATE TABLE bridge_ai."ContactAccessGrant" (
  id text PRIMARY KEY,
  "successFeeId" text NOT NULL UNIQUE,
  "quotationId" text NOT NULL UNIQUE,
  "customerContactId" text NOT NULL,
  "supplierCompanyId" text NOT NULL,
  reason text NOT NULL DEFAULT 'SUCCESS_FEE_PAID',
  "grantedAt" timestamptz NOT NULL DEFAULT now(),
  "revokedAt" timestamptz,
  "customerNotifiedAt" timestamptz,
  "notificationAttemptedAt" timestamptz,
  "notificationFailureCode" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_access_fee_fk FOREIGN KEY ("successFeeId")
    REFERENCES bridge_ai."SupplierSuccessFee"(id) ON DELETE RESTRICT,
  CONSTRAINT contact_access_quotation_fk FOREIGN KEY ("quotationId")
    REFERENCES bridge_ai."SupplierQuotation"(id) ON DELETE RESTRICT,
  CONSTRAINT contact_access_customer_fk FOREIGN KEY ("customerContactId")
    REFERENCES bridge_ai."CustomerContact"(id) ON DELETE RESTRICT,
  CONSTRAINT contact_access_company_fk FOREIGN KEY ("supplierCompanyId")
    REFERENCES bridge_ai.supplier_companies(id) ON DELETE RESTRICT,
  CONSTRAINT contact_access_reason CHECK (reason = 'SUCCESS_FEE_PAID'),
  CONSTRAINT contact_access_revocation_sequence CHECK ("revokedAt" IS NULL OR "revokedAt" >= "grantedAt"),
  CONSTRAINT contact_access_notification_sequence CHECK (
    "customerNotifiedAt" IS NULL OR (
      "notificationAttemptedAt" IS NOT NULL
      AND "customerNotifiedAt" >= "notificationAttemptedAt"
      AND "notificationFailureCode" IS NULL
    )
  )
);

CREATE INDEX "ContactAccessGrant_supplierCompanyId_grantedAt_idx"
  ON bridge_ai."ContactAccessGrant" ("supplierCompanyId", "grantedAt");
CREATE INDEX "ContactAccessGrant_customerContactId_idx"
  ON bridge_ai."ContactAccessGrant" ("customerContactId");

CREATE UNIQUE INDEX supplier_quotation_one_customer_selection
  ON bridge_ai."SupplierQuotation" ("quoteRequestId")
  WHERE status IN ('SELECTED_PENDING_PAYMENT', 'ACCEPTED');

ALTER TABLE bridge_ai."SupplierQuotation"
  DROP CONSTRAINT quotation_status_timestamps,
  ADD CONSTRAINT quotation_status_timestamps CHECK (
    (status = 'DRAFT' AND "submittedAt" IS NULL AND "decidedAt" IS NULL)
    OR (status IN ('SUBMITTED','WITHDRAWN','EXPIRED') AND "submittedAt" IS NOT NULL)
    OR (status IN ('SELECTED_PENDING_PAYMENT','ACCEPTED','REJECTED') AND "submittedAt" IS NOT NULL AND "decidedAt" IS NOT NULL)
  );

ALTER TABLE bridge_ai."SupplierSuccessFee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."SupplierSuccessFee" FORCE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."ContactAccessGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_ai."ContactAccessGrant" FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_administrator_all ON bridge_ai."SupplierSuccessFee"
  FOR ALL TO authenticated
  USING ((SELECT bridge_private.is_platform_admin()))
  WITH CHECK ((SELECT bridge_private.is_platform_admin()));
CREATE POLICY success_fee_company_read ON bridge_ai."SupplierSuccessFee"
  FOR SELECT TO authenticated
  USING ((SELECT bridge_private.has_company_membership("supplierCompanyId")));

CREATE POLICY platform_administrator_all ON bridge_ai."ContactAccessGrant"
  FOR ALL TO authenticated
  USING ((SELECT bridge_private.is_platform_admin()))
  WITH CHECK ((SELECT bridge_private.is_platform_admin()));
CREATE POLICY contact_access_company_read ON bridge_ai."ContactAccessGrant"
  FOR SELECT TO authenticated
  USING (
    "revokedAt" IS NULL
    AND (SELECT bridge_private.has_company_membership("supplierCompanyId"))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON bridge_ai."SupplierSuccessFee", bridge_ai."ContactAccessGrant"
  TO authenticated, service_role;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON bridge_ai."SupplierSuccessFee", bridge_ai."ContactAccessGrant"
  FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridge_ai_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON bridge_ai."SupplierSuccessFee", bridge_ai."ContactAccessGrant" TO bridge_ai_app';
    EXECUTE 'REVOKE TRUNCATE, REFERENCES, TRIGGER ON bridge_ai."SupplierSuccessFee", bridge_ai."ContactAccessGrant" FROM bridge_ai_app';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION bridge_private.enforce_success_fee_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE quotation_row bridge_ai."SupplierQuotation"%ROWTYPE;
BEGIN
  SELECT * INTO quotation_row
  FROM bridge_ai."SupplierQuotation"
  WHERE id = NEW."quotationId";
  IF quotation_row.id IS NULL
    OR quotation_row."quoteRequestId" <> NEW."quoteRequestId"
    OR quotation_row."supplierCompanyId" <> NEW."supplierCompanyId" THEN
    RAISE EXCEPTION 'success fee does not match quotation tenant and request' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

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
  SELECT * INTO fee_row FROM bridge_ai."SupplierSuccessFee" WHERE id = NEW."successFeeId";
  SELECT * INTO quotation_row FROM bridge_ai."SupplierQuotation" WHERE id = NEW."quotationId";
  SELECT "customerContactId" INTO request_customer_id
  FROM bridge_ai."QuoteRequest" WHERE id = quotation_row."quoteRequestId";
  IF fee_row.id IS NULL OR fee_row.status <> 'PAID' OR fee_row."unlockedAt" IS NULL
    OR fee_row."quotationId" <> NEW."quotationId"
    OR fee_row."supplierCompanyId" <> NEW."supplierCompanyId"
    OR quotation_row."supplierCompanyId" <> NEW."supplierCompanyId"
    OR request_customer_id <> NEW."customerContactId" THEN
    RAISE EXCEPTION 'contact access requires a matching paid success fee' USING ERRCODE = '23514';
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
      AND subscription.status = 'ACTIVE'
      AND (subscription."currentPeriodEnd" IS NULL OR subscription."currentPeriodEnd" > now())
  ) THEN
    RAISE EXCEPTION 'an active supplier membership is required to submit a quotation' USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('SELECTED_PENDING_PAYMENT', 'ACCEPTED')
    AND OLD.status IS DISTINCT FROM NEW.status
    AND NOT bridge_private.is_platform_admin()
    AND coalesce(current_setting('bridge_ai.payment_transition', true), '') <> 'on' THEN
    RAISE EXCEPTION 'customer selection and payment transitions are server controlled' USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'selected quotation requires a pending success fee' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'ACCEPTED' AND NOT EXISTS (
    SELECT 1
    FROM bridge_ai."SupplierSuccessFee" fee
    JOIN bridge_ai."ContactAccessGrant" grant_row ON grant_row."successFeeId" = fee.id
    WHERE fee."quotationId" = NEW.id
      AND fee.status = 'PAID'
      AND grant_row."revokedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'accepted quotation requires paid fee and contact grant' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_success_fee_consistency() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bridge_private.enforce_contact_access_consistency() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bridge_private.enforce_payment_gated_quotation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bridge_private.validate_payment_gated_quotation() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER success_fee_consistency
  BEFORE INSERT OR UPDATE ON bridge_ai."SupplierSuccessFee"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_success_fee_consistency();
CREATE TRIGGER contact_access_consistency
  BEFORE INSERT OR UPDATE ON bridge_ai."ContactAccessGrant"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_contact_access_consistency();
CREATE TRIGGER payment_gated_quotation_transition
  BEFORE UPDATE OF status ON bridge_ai."SupplierQuotation"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_payment_gated_quotation();
CREATE CONSTRAINT TRIGGER payment_gated_quotation_state
  AFTER INSERT OR UPDATE OF status ON bridge_ai."SupplierQuotation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bridge_private.validate_payment_gated_quotation();
