-- Specific trade-product categories prevent a quote from reaching a supplier
-- that only selected a broad but incompatible material or product family.
INSERT INTO bridge_ai."ProductCategory" (
  id, name, slug, description, active, "parentId", "displayOrder", "createdAt", "updatedAt"
) VALUES
  ('category_upvc_windows', 'uPVC windows', 'upvc-windows', 'uPVC window systems and replacement windows.', true, 'category_windows', 11, now(), now()),
  ('category_aluminium_windows', 'Aluminium windows', 'aluminium-windows', 'Aluminium window systems, including commercial and residential profiles.', true, 'category_windows', 12, now(), now()),
  ('category_timber_windows', 'Timber windows', 'timber-windows', 'Timber and timber-look window systems.', true, 'category_windows', 13, now(), now()),
  ('category_upvc_doors', 'uPVC doors', 'upvc-doors', 'uPVC entrance, French and back door systems.', true, 'category_doors', 21, now(), now()),
  ('category_aluminium_doors', 'Aluminium doors', 'aluminium-doors', 'Aluminium entrance, French and commercial door systems.', true, 'category_doors', 22, now(), now()),
  ('category_timber_doors', 'Timber doors', 'timber-doors', 'Timber entrance, French and external door systems.', true, 'category_doors', 23, now(), now()),
  ('category_bifold_doors', 'Bifold doors', 'bifold-doors', 'Aluminium, uPVC and timber bifolding door systems.', true, 'category_doors', 24, now(), now()),
  ('category_composite_doors', 'Composite doors', 'composite-doors', 'Composite entrance and external door sets.', true, 'category_doors', 25, now(), now()),
  ('category_patio_sliders', 'Patio sliding doors', 'patio-sliding-doors', 'Patio sliders, lift-and-slide and inline sliding door systems.', true, 'category_doors', 26, now(), now()),
  ('category_conservatory_systems', 'Conservatories', 'conservatories', 'Complete conservatory frames, roofs and associated systems.', true, 'category_conservatories', 31, now(), now()),
  ('category_roof_lanterns', 'Roof lanterns', 'roof-lanterns', 'Glazed roof lanterns, rooflights and related systems.', true, 'category_roofing', 41, now(), now()),
  ('category_juliet_balconies', 'Juliet balconies', 'juliet-balconies', 'Juliet balcony systems, balustrades and associated fixings.', true, 'category_other_building_products', 61, now(), now())
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = true,
  "parentId" = EXCLUDED."parentId",
  "displayOrder" = EXCLUDED."displayOrder",
  "updatedAt" = now();

UPDATE bridge_ai."ProductCategory"
SET description = CASE slug
  WHEN 'windows' THEN 'Broad window category for requests where the frame material is not yet known.'
  WHEN 'doors' THEN 'Broad door category for requests where the door type or material is not yet known.'
  WHEN 'conservatories-extensions' THEN 'Broad category for glazed extensions and conservatory work not covered by a specific product.'
  ELSE description
END,
"updatedAt" = now()
WHERE slug IN ('windows', 'doors', 'conservatories-extensions');

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_trade_product_categories_v1',
  'SYSTEM.PRODUCT_CATEGORIES_EXPANDED',
  'ProductCategory',
  NULL,
  'Trade product catalogue expanded for exact supplier matching',
  jsonb_build_object('slugs', jsonb_build_array(
    'upvc-windows', 'aluminium-windows', 'timber-windows',
    'upvc-doors', 'aluminium-doors', 'timber-doors',
    'bifold-doors', 'composite-doors', 'patio-sliding-doors',
    'conservatories', 'roof-lanterns', 'juliet-balconies'
  )),
  now()
)
ON CONFLICT (id) DO NOTHING;
