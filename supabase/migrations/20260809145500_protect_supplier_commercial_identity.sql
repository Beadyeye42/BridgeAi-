-- Founding-place and other commercial entitlements are administrator-controlled
-- even though suppliers can edit their ordinary company profile fields.
CREATE OR REPLACE FUNCTION bridge_private.protect_supplier_commercial_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW."foundingMemberNumber" IS DISTINCT FROM OLD."foundingMemberNumber"
     AND NOT (SELECT bridge_private.is_platform_admin()) THEN
    RAISE EXCEPTION 'founding supplier place is administrator controlled'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.protect_supplier_commercial_identity()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS protect_supplier_commercial_identity ON bridge_ai.supplier_companies;
CREATE TRIGGER protect_supplier_commercial_identity
  BEFORE UPDATE OF "foundingMemberNumber" ON bridge_ai.supplier_companies
  FOR EACH ROW EXECUTE FUNCTION bridge_private.protect_supplier_commercial_identity();

INSERT INTO bridge_ai."AuditLog" (id, action, "entityType", summary, metadata, "createdAt")
VALUES (
  'system_supplier_commercial_identity_20260809145500',
  'SYSTEM.SUPPLIER_COMMERCIAL_IDENTITY_PROTECTED',
  'SecurityConfiguration',
  'Restricted supplier founding-place changes to platform administrators',
  jsonb_build_object('protectedField', 'foundingMemberNumber'),
  now()
);
