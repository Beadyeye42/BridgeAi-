-- Replacing the approval trigger function in the simplified onboarding
-- migration reset it to SECURITY INVOKER. Restore SECURITY DEFINER so the
-- trigger can call the private administrator check while still authorising the
-- signed-in actor through auth.uid(). The function has a fixed empty search
-- path and remains non-executable by portal roles outside trigger execution.
ALTER FUNCTION bridge_private.enforce_supplier_review_state() SECURITY DEFINER;

REVOKE ALL ON FUNCTION bridge_private.enforce_supplier_review_state()
  FROM PUBLIC, anon, authenticated, service_role;
