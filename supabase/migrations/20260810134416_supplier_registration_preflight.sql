-- Check application-owned registration state before Supabase Auth sends an
-- email or creates a credential record. This avoids duplicate workspace
-- attempts and prevents an existing unconfirmed Auth user being mistaken for
-- a newly-created user during rollback cleanup.
CREATE OR REPLACE FUNCTION bridge_private.preflight_supplier_registration(
  supplier_email text,
  supplied_referral_code text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = '' AS $$
BEGIN
  IF session_user <> 'bridge_ai_app' THEN
    RAISE EXCEPTION 'trusted application role required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM bridge_ai.portal_profiles profile
    WHERE profile.email = lower(trim(supplier_email))
  ) THEN
    RETURN 'EMAIL_EXISTS';
  END IF;

  IF supplied_referral_code IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM bridge_ai.affiliates affiliate
    WHERE affiliate.code = upper(trim(supplied_referral_code))
      AND affiliate.status = 'ACTIVE'
  ) THEN
    RETURN 'INVALID_REFERRAL';
  END IF;

  RETURN 'OK';
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.preflight_supplier_registration(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridge_ai_app') THEN
    GRANT EXECUTE ON FUNCTION bridge_private.preflight_supplier_registration(text, text)
      TO bridge_ai_app;
  END IF;
END $$;
