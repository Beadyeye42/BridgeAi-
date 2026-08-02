-- Invitation acceptance is an atomic, narrowly scoped trusted operation.
CREATE OR REPLACE FUNCTION bridge_private.accept_supplier_invitation(
  auth_user_id uuid,
  invitation_token_hash text,
  supplier_email text,
  first_name text,
  last_name text,
  accepted_terms_version text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE invitation bridge_ai."SupplierInvite"%ROWTYPE;
BEGIN
  IF session_user <> 'bridge_ai_app' THEN
    RAISE EXCEPTION 'trusted application role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO invitation
  FROM bridge_ai."SupplierInvite"
  WHERE "tokenHash" = invitation_token_hash
    AND "acceptedAt" IS NULL
    AND "expiresAt" > now()
  FOR UPDATE;
  IF invitation.id IS NULL OR lower(invitation.email) <> lower(trim(supplier_email)) THEN
    RAISE EXCEPTION 'invalid or expired invitation' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users au
    WHERE au.id = auth_user_id AND lower(au.email) = lower(trim(supplier_email))
  ) THEN
    RAISE EXCEPTION 'Supabase Auth identity does not match invitation' USING ERRCODE = '28000';
  END IF;
  IF EXISTS (SELECT 1 FROM bridge_ai.portal_profiles pp WHERE pp.id = auth_user_id) THEN
    RAISE EXCEPTION 'portal profile already exists' USING ERRCODE = '23505';
  END IF;

  INSERT INTO bridge_ai.portal_profiles (
    id, email, "firstName", "lastName", status, "emailVerifiedAt",
    "termsAcceptedAt", "termsVersion", "createdAt", "updatedAt"
  )
  SELECT au.id, lower(trim(supplier_email)), trim(first_name), trim(last_name), 'ACTIVE', au.email_confirmed_at,
         now(), accepted_terms_version, now(), now()
  FROM auth.users au WHERE au.id = auth_user_id;

  INSERT INTO bridge_ai.company_memberships (
    id, "userId", "supplierCompanyId", role, status, "isPrimary", "joinedAt"
  ) VALUES (
    'membership_' || replace(gen_random_uuid()::text, '-', ''), auth_user_id,
    invitation."supplierCompanyId", invitation.role, 'ACTIVE', true, now()
  );
  UPDATE bridge_ai."SupplierInvite" SET "acceptedAt" = now() WHERE id = invitation.id;
  INSERT INTO bridge_ai."AuditLog" (
    id, "actorUserId", "supplierCompanyId", action, "entityType", "entityId", summary, metadata, "createdAt"
  ) VALUES (
    'audit_' || replace(gen_random_uuid()::text, '-', ''), auth_user_id, invitation."supplierCompanyId",
    'TEAM.INVITATION_ACCEPTED', 'SupplierInvite', invitation.id,
    'Supplier team invitation accepted through Supabase Auth', jsonb_build_object('termsVersion', accepted_terms_version), now()
  );
  RETURN invitation."supplierCompanyId";
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.accept_supplier_invitation(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridge_ai_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION bridge_private.accept_supplier_invitation(uuid, text, text, text, text, text) TO bridge_ai_app';
  END IF;
END $$;
