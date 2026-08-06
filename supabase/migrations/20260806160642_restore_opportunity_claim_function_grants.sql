-- Recreating a function can leave execution available through inherited
-- defaults. Reassert the server-only grant explicitly after the catalogue
-- migration so browser-authenticated roles cannot invoke this privileged path.
REVOKE ALL ON FUNCTION bridge_private.claim_supplier_opportunity(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION bridge_private.claim_supplier_opportunity(text, text)
  TO bridge_ai_app;
