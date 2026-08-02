-- The Prisma server connection remains subject to the same authenticated RLS policies.
-- A verified Supabase user id is installed transaction-locally by lib/db.ts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridge_ai_app') THEN
    EXECUTE 'ALTER ROLE bridge_ai_app INHERIT';
    EXECUTE 'GRANT authenticated TO bridge_ai_app';
    EXECUTE 'GRANT USAGE ON SCHEMA bridge_ai, bridge_private TO bridge_ai_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bridge_ai TO bridge_ai_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION bridge_private.current_user_id() TO bridge_ai_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION bridge_private.is_platform_admin() TO bridge_ai_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION bridge_private.has_company_membership(text, bridge_ai."SupplierTeamRole"[]) TO bridge_ai_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION bridge_private.can_access_request(text) TO bridge_ai_app';
    EXECUTE 'REVOKE ALL ON TABLE public.profiles, public.quotes, public.request_customers, public.requests, public.subscriptions, public.whatsapp_messages FROM bridge_ai_app';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION bridge_private.bootstrap_supplier(
  auth_user_id uuid,
  supplier_email text,
  first_name text,
  last_name text,
  company_name text,
  contact_phone text,
  accepted_terms_version text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  company_id text := 'company_' || replace(gen_random_uuid()::text, '-', '');
  normalised_email text := lower(trim(supplier_email));
BEGIN
  IF session_user <> 'bridge_ai_app' THEN
    RAISE EXCEPTION 'trusted application role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users au
    WHERE au.id = auth_user_id AND lower(au.email) = normalised_email
  ) THEN
    RAISE EXCEPTION 'Supabase Auth identity does not match registration' USING ERRCODE = '28000';
  END IF;
  IF EXISTS (SELECT 1 FROM bridge_ai.portal_profiles pp WHERE pp.id = auth_user_id) THEN
    RAISE EXCEPTION 'portal profile already exists' USING ERRCODE = '23505';
  END IF;

  INSERT INTO bridge_ai.portal_profiles (
    id, email, "firstName", "lastName", status, "emailVerifiedAt",
    "termsAcceptedAt", "termsVersion", "createdAt", "updatedAt"
  )
  SELECT au.id, normalised_email, trim(first_name), trim(last_name), 'ACTIVE', au.email_confirmed_at,
         now(), accepted_terms_version, now(), now()
  FROM auth.users au WHERE au.id = auth_user_id;

  INSERT INTO bridge_ai.supplier_companies (
    id, "legalName", "contactEmail", "contactPhone", status, "createdAt", "updatedAt"
  ) VALUES (
    company_id, trim(company_name), normalised_email, trim(contact_phone), 'PENDING', now(), now()
  );

  INSERT INTO bridge_ai.company_memberships (
    id, "userId", "supplierCompanyId", role, status, "isPrimary", "joinedAt"
  ) VALUES (
    'membership_' || replace(gen_random_uuid()::text, '-', ''), auth_user_id, company_id,
    'OWNER', 'ACTIVE', true, now()
  );

  INSERT INTO bridge_ai."AuditLog" (
    id, "actorUserId", "supplierCompanyId", action, "entityType", "entityId", summary, metadata, "createdAt"
  ) VALUES (
    'audit_' || replace(gen_random_uuid()::text, '-', ''), auth_user_id, company_id,
    'AUTH.SUPPLIER_REGISTERED', 'SupplierCompany', company_id,
    'Supplier registered through Supabase Auth', jsonb_build_object('termsVersion', accepted_terms_version), now()
  );

  RETURN company_id;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.bootstrap_supplier(uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridge_ai_app') THEN
    GRANT EXECUTE ON FUNCTION bridge_private.bootstrap_supplier(uuid, text, text, text, text, text, text) TO bridge_ai_app;
  END IF;
END $$;
