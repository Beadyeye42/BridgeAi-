-- An empty production catalogue prevents the consented WhatsApp intake from
-- classifying an enquiry. These broad starter categories remain editable by
-- administrators and can be expanded without changing the intake workflow.
INSERT INTO bridge_ai."ProductCategory" (
  id, name, slug, description, active, "displayOrder", "createdAt", "updatedAt"
) VALUES
  ('category_windows', 'Windows', 'windows', 'Window systems, glazing and associated components.', true, 10, now(), now()),
  ('category_doors', 'Doors', 'doors', 'Entrance, patio, bifold, French and commercial door systems.', true, 20, now(), now()),
  ('category_conservatories', 'Conservatories and extensions', 'conservatories-extensions', 'Conservatories, glazed extensions, roof systems and related products.', true, 30, now(), now()),
  ('category_roofing', 'Roofing', 'roofing', 'Roofing systems, rooflights, membranes and associated materials.', true, 40, now(), now()),
  ('category_building_materials', 'Building materials', 'building-materials', 'General construction products and building materials.', true, 50, now(), now()),
  ('category_other_building_products', 'Other building products', 'other-building-products', 'Building products that do not yet have a dedicated category.', true, 60, now(), now())
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = true,
  "displayOrder" = EXCLUDED."displayOrder",
  "updatedAt" = now();

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_initial_product_categories',
  'SYSTEM.PRODUCT_CATEGORIES_SEEDED',
  'ProductCategory',
  NULL,
  'Initial production product category catalogue activated',
  jsonb_build_object('slugs', jsonb_build_array(
    'windows', 'doors', 'conservatories-extensions', 'roofing',
    'building-materials', 'other-building-products'
  )),
  now()
)
ON CONFLICT (id) DO NOTHING;
