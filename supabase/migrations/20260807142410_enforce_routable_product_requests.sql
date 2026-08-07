-- Quote requests must target an exact, launched child product. An industry
-- root is a navigation and intake choice, never a supplier-routing category.
CREATE OR REPLACE FUNCTION bridge_private.enforce_routable_quote_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  is_routable boolean;
BEGIN
  SELECT category.active AND parent.active
  INTO is_routable
  FROM bridge_ai."ProductCategory" category
  JOIN bridge_ai."ProductCategory" parent ON parent.id = category."parentId"
  WHERE category.id = NEW."categoryId";

  IF COALESCE(is_routable, false) = false THEN
    RAISE EXCEPTION 'QUOTE_REQUEST_REQUIRES_ACTIVE_PRODUCT_CATEGORY'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quote_request_routable_product_guard ON bridge_ai."QuoteRequest";
CREATE TRIGGER quote_request_routable_product_guard
BEFORE INSERT OR UPDATE OF "categoryId" ON bridge_ai."QuoteRequest"
FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_routable_quote_product();

REVOKE ALL ON FUNCTION bridge_private.enforce_routable_quote_product() FROM PUBLIC;

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_routable_quote_product_guard_v1',
  'SYSTEM.ROUTABLE_PRODUCT_GUARD_ENABLED',
  'QuoteRequest',
  NULL,
  'Quote requests now require an active product beneath an active industry',
  jsonb_build_object('industryRootsRoutable', false),
  now()
)
ON CONFLICT (id) DO NOTHING;
