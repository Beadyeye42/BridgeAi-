-- Launch Transport, Delivery and Removals as a first-class Bridge AI industry.
-- The root is the administrator's launch switch. Child categories are the
-- exact services suppliers select and WhatsApp routes requests into.
INSERT INTO bridge_ai."ProductCategory" (
  id, name, slug, description, active, "parentId", "displayOrder", "adminVisible", "createdAt", "updatedAt"
) VALUES (
  'category_transport_delivery_removals',
  'Transport, delivery and removals',
  'transport-delivery-removals',
  'On-demand transport, collection, delivery and removal services for trade, business and domestic requirements.',
  true, NULL, 400, true, now(), now()
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = true,
  "parentId" = NULL,
  "displayOrder" = EXCLUDED."displayOrder",
  "adminVisible" = true,
  "updatedAt" = now();

INSERT INTO bridge_ai."ProductCategory" (
  id, name, slug, description, active, "parentId", "displayOrder", "adminVisible", "createdAt", "updatedAt"
) VALUES
  ('category_man_with_van', 'Man with a van', 'man-with-a-van', 'Flexible van-and-driver transport for single items, trade collections, small moves and local deliveries.', true, 'category_transport_delivery_removals', 401, true, now(), now()),
  ('category_trade_collection_delivery', 'Trade collections and deliveries', 'trade-collection-delivery', 'Collection from merchants, manufacturers or sites and delivery to a business, customer or project location.', true, 'category_transport_delivery_removals', 402, true, now(), now()),
  ('category_same_day_courier', 'Same-day courier', 'same-day-courier', 'Urgent, direct and time-critical courier work for documents, parcels, parts and trade materials.', true, 'category_transport_delivery_removals', 403, true, now(), now()),
  ('category_furniture_small_removals', 'Furniture and small removals', 'furniture-small-removals', 'Furniture moves, single-room moves and smaller domestic or business removals.', true, 'category_transport_delivery_removals', 404, true, now(), now()),
  ('category_bulky_item_transport', 'Bulky-item transport', 'bulky-item-transport', 'Transport for large, awkward or heavy items that require suitable vehicle space, handling or extra crew.', true, 'category_transport_delivery_removals', 405, true, now(), now()),
  ('category_building_material_deliveries', 'Building-material deliveries', 'building-material-deliveries', 'Collection and delivery of building products and trade materials, subject to confirmed size, weight and handling requirements.', true, 'category_transport_delivery_removals', 406, true, now(), now()),
  ('category_multi_drop_delivery', 'Multi-drop delivery', 'multi-drop-delivery', 'Planned collection and delivery routes with multiple stops, timed drops or proof-of-delivery requirements.', true, 'category_transport_delivery_removals', 407, true, now(), now())
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  "parentId" = EXCLUDED."parentId",
  "displayOrder" = EXCLUDED."displayOrder",
  "adminVisible" = true,
  "updatedAt" = now();

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_transport_delivery_removals_launch_v1',
  'SYSTEM.PRODUCT_CATALOGUE_LAUNCHED',
  'ProductCategory',
  'category_transport_delivery_removals',
  'Transport, delivery and removals catalogue launched',
  jsonb_build_object(
    'launchRoot', 'transport-delivery-removals',
    'products', jsonb_build_array(
      'man-with-a-van', 'trade-collection-delivery', 'same-day-courier',
      'furniture-small-removals', 'bulky-item-transport',
      'building-material-deliveries', 'multi-drop-delivery'
    ),
    'safetyNote', 'Regulated waste disposal is not included in this launch catalogue.'
  ),
  now()
)
ON CONFLICT (id) DO NOTHING;
