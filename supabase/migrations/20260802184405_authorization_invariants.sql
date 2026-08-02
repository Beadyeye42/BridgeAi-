-- Close authorization and workflow invariants that require transaction-safe triggers.
DROP POLICY IF EXISTS bridge_ai_storage_insert ON storage.objects;
CREATE POLICY bridge_ai_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'bridge-ai-private'
    AND (
      ((storage.foldername(name))[1] = 'companies'
       AND (SELECT bridge_private.has_company_membership((storage.foldername(name))[2])))
      OR (SELECT bridge_private.is_platform_admin())
    )
  );

CREATE OR REPLACE FUNCTION bridge_private.protect_own_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) = OLD."userId"
     AND NOT (SELECT bridge_private.is_platform_admin())
     AND (
       TG_OP = 'DELETE'
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW."userId" IS DISTINCT FROM OLD."userId"
       OR NEW."supplierCompanyId" IS DISTINCT FROM OLD."supplierCompanyId"
     ) THEN
    RAISE EXCEPTION 'users cannot alter their own authorization membership' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.protect_own_membership() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS protect_own_membership ON bridge_ai.company_memberships;
CREATE TRIGGER protect_own_membership
  BEFORE UPDATE OR DELETE ON bridge_ai.company_memberships
  FOR EACH ROW EXECUTE FUNCTION bridge_private.protect_own_membership();

CREATE OR REPLACE FUNCTION bridge_private.require_active_company_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE target_company text := COALESCE(NEW."supplierCompanyId", OLD."supplierCompanyId");
BEGIN
  IF EXISTS (SELECT 1 FROM bridge_ai.supplier_companies WHERE id = target_company)
     AND NOT EXISTS (
       SELECT 1 FROM bridge_ai.company_memberships
       WHERE "supplierCompanyId" = target_company AND role = 'OWNER' AND status = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION 'a supplier company must retain an active owner' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.require_active_company_owner() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS require_active_company_owner ON bridge_ai.company_memberships;
CREATE CONSTRAINT TRIGGER require_active_company_owner
  AFTER INSERT OR UPDATE OR DELETE ON bridge_ai.company_memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bridge_private.require_active_company_owner();

CREATE OR REPLACE FUNCTION bridge_private.enforce_assignment_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'QUOTED' AND NOT EXISTS (
    SELECT 1 FROM bridge_ai."SupplierQuotation"
    WHERE "assignmentId" = NEW.id AND status IN ('SUBMITTED','ACCEPTED','REJECTED','WITHDRAWN','EXPIRED')
  ) THEN
    RAISE EXCEPTION 'quoted assignment requires a submitted quotation' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'DECLINED' AND EXISTS (
    SELECT 1 FROM bridge_ai."SupplierQuotation"
    WHERE "assignmentId" = NEW.id AND status NOT IN ('WITHDRAWN','EXPIRED')
  ) THEN
    RAISE EXCEPTION 'declined assignment cannot retain an active quotation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.enforce_assignment_state() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_assignment_state ON bridge_ai."SupplierAssignment";
CREATE TRIGGER enforce_assignment_state
  BEFORE INSERT OR UPDATE ON bridge_ai."SupplierAssignment"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_assignment_state();

CREATE OR REPLACE FUNCTION bridge_private.enforce_request_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE accepted_count integer;
BEGIN
  IF NEW.status IN ('WON','LOST') THEN
    SELECT count(*) INTO accepted_count
    FROM bridge_ai."SupplierQuotation"
    WHERE "quoteRequestId" = NEW.id AND status = 'ACCEPTED';
    IF NEW.status = 'WON' AND accepted_count <> 1 THEN
      RAISE EXCEPTION 'won request requires exactly one accepted quotation' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'LOST' AND accepted_count <> 0 THEN
      RAISE EXCEPTION 'lost request cannot have an accepted quotation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.enforce_request_outcome() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_request_outcome ON bridge_ai."QuoteRequest";
CREATE TRIGGER enforce_request_outcome
  BEFORE INSERT OR UPDATE ON bridge_ai."QuoteRequest"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_request_outcome();
