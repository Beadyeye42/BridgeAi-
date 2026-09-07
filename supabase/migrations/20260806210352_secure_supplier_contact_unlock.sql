-- Suppliers must never be able to read customer rows directly. Expose only
-- the encrypted contact fields for a quotation that the customer selected,
-- after re-checking the signed-in user's active company membership.
CREATE OR REPLACE FUNCTION bridge_private.get_unlocked_customer_contact(
  target_quotation_id text,
  target_company_id text
)
RETURNS TABLE (
  "customerContactId" text,
  "displayNameEncrypted" bytea,
  "phoneEncrypted" bytea,
  "emailEncrypted" bytea
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    customer.id,
    customer."displayNameEncrypted",
    customer."phoneEncrypted",
    customer."emailEncrypted"
  FROM bridge_ai."ContactAccessGrant" grant_row
  JOIN bridge_ai."SupplierQuotation" quotation
    ON quotation.id = grant_row."quotationId"
  JOIN bridge_ai."CustomerContact" customer
    ON customer.id = grant_row."customerContactId"
  WHERE grant_row."quotationId" = target_quotation_id
    AND grant_row."supplierCompanyId" = target_company_id
    AND grant_row."revokedAt" IS NULL
    AND quotation.status = 'ACCEPTED'
    AND quotation."supplierCompanyId" = target_company_id
    AND bridge_private.has_company_membership(target_company_id)
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION bridge_private.get_unlocked_customer_contact(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridge_ai_app') THEN
    GRANT EXECUTE ON FUNCTION bridge_private.get_unlocked_customer_contact(text, text)
      TO bridge_ai_app;
  END IF;
END
$$;

COMMENT ON FUNCTION bridge_private.get_unlocked_customer_contact(text, text) IS
  'Server-only, identity-checked contact read for the supplier whose quotation was selected.';
