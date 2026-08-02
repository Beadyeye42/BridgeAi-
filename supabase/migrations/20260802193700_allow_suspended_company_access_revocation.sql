-- Active companies must retain an owner. Deliberately suspended or rejected
-- companies must be able to revoke all memberships immediately.
CREATE OR REPLACE FUNCTION bridge_private.require_active_company_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE target_company text := COALESCE(NEW."supplierCompanyId", OLD."supplierCompanyId");
BEGIN
  IF EXISTS (
       SELECT 1 FROM bridge_ai.supplier_companies
       WHERE id = target_company AND status NOT IN ('SUSPENDED', 'REJECTED')
     )
     AND NOT EXISTS (
       SELECT 1 FROM bridge_ai.company_memberships
       WHERE "supplierCompanyId" = target_company AND role = 'OWNER' AND status = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION 'an active supplier company must retain an active owner' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.require_active_company_owner() FROM PUBLIC, anon, authenticated;
