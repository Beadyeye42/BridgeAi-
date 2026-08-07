-- Authenticated Data API requests must be able to evaluate the small set of
-- security-definer helpers used by RLS policies. Schema USAGE only permits
-- name resolution; function EXECUTE remains explicitly allow-listed below.
GRANT USAGE ON SCHEMA bridge_private TO authenticated;
REVOKE USAGE ON SCHEMA bridge_private FROM anon;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Keep the
-- private schema deny-by-default, including future functions.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA bridge_private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA bridge_private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT EXECUTE ON FUNCTION bridge_private.current_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION bridge_private.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION bridge_private.has_company_membership(
  text,
  bridge_ai."SupplierTeamRole"[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION bridge_private.can_access_request(text) TO authenticated;
GRANT EXECUTE ON FUNCTION bridge_private.can_browse_supplier_opportunities() TO authenticated;
GRANT EXECUTE ON FUNCTION bridge_private.is_trusted_worker(text) TO authenticated;

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_authenticated_policy_helper_usage_v1',
  'SYSTEM.AUTHENTICATED_POLICY_HELPERS_RESTORED',
  'SecurityConfiguration',
  NULL,
  'Authenticated requests can evaluate allow-listed RLS policy helpers',
  jsonb_build_object(
    'schema', 'bridge_private',
    'anonymousUsage', false,
    'publicFunctionExecution', false
  ),
  now()
)
ON CONFLICT (id) DO NOTHING;
