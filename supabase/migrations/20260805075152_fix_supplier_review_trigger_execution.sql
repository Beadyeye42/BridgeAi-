-- Trigger execution inherits the role performing the supplier update. The
-- authenticated role deliberately has no USAGE on bridge_private, so the
-- validator must execute as its database owner. Its fixed empty search_path,
-- fully-qualified references, trigger-only signature, and revoked EXECUTE
-- privileges keep this SECURITY DEFINER surface narrow.
ALTER FUNCTION bridge_private.enforce_supplier_review_state() SECURITY DEFINER;

REVOKE ALL ON FUNCTION bridge_private.enforce_supplier_review_state() FROM PUBLIC, anon, authenticated;
