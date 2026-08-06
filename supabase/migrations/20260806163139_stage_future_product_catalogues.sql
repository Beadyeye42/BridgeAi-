-- Future product groups are staged with their root disabled. Child products
-- may be prepared independently, but no supplier or WhatsApp intake can see
-- them until an administrator explicitly launches the parent group.
INSERT INTO bridge_ai."ProductCategory" (
  id, name, slug, description, active, "parentId", "displayOrder", "createdAt", "updatedAt"
) VALUES
  (
    'category_bespoke_metal_fabrication',
    'Bespoke metal fabrication',
    'bespoke-metal-fabrication',
    'Drawing-led structural and architectural metalwork. Suppliers remain responsible for engineering, manufacturing drawings, tolerances, fixings and compliance.',
    false, NULL, 100, now(), now()
  ),
  (
    'category_specialist_doors',
    'Garage, industrial and specialist doors',
    'garage-industrial-specialist-doors',
    'Specification-led garage, industrial, security, automatic and commercial door systems, including access and survey requirements.',
    false, NULL, 200, now(), now()
  )
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = false,
  "parentId" = NULL,
  "displayOrder" = EXCLUDED."displayOrder",
  "updatedAt" = now();

INSERT INTO bridge_ai."ProductCategory" (
  id, name, slug, description, active, "parentId", "displayOrder", "createdAt", "updatedAt"
) VALUES
  ('category_steel_beams', 'Steel beams', 'steel-beams', 'Structural steel beams, including section, grade, length, finish, holes and fabrication requirements.', true, 'category_bespoke_metal_fabrication', 101, now(), now()),
  ('category_lintels', 'Lintels', 'lintels', 'Standard and bespoke steel lintels, including loading, span, bearing, cavity and corrosion-protection details.', true, 'category_bespoke_metal_fabrication', 102, now(), now()),
  ('category_fabricated_frames', 'Fabricated frames', 'fabricated-frames', 'Welded and bolted metal frames made from drawings, schedules or measured requirements.', true, 'category_bespoke_metal_fabrication', 103, now(), now()),
  ('category_balustrades', 'Balustrades', 'balustrades', 'Steel, stainless-steel and aluminium balustrade systems, including infill, finish and fixing requirements.', true, 'category_bespoke_metal_fabrication', 104, now(), now()),
  ('category_gates', 'Gates', 'gates', 'Bespoke pedestrian, driveway and commercial metal gates, including finish, automation readiness and ironmongery.', true, 'category_bespoke_metal_fabrication', 105, now(), now()),
  ('category_railings', 'Railings', 'railings', 'Made-to-measure metal railings and guarding, including pattern, height, finish and fixing requirements.', true, 'category_bespoke_metal_fabrication', 106, now(), now()),
  ('category_balconies', 'Balconies', 'balconies', 'Fabricated balcony structures and guarding supplied from architectural or engineering information.', true, 'category_bespoke_metal_fabrication', 107, now(), now()),
  ('category_staircases', 'Staircases', 'staircases', 'Internal and external metal staircases, stringers, treads, landings and guarding supplied from drawings.', true, 'category_bespoke_metal_fabrication', 108, now(), now()),
  ('category_structural_steel', 'Structural steel', 'structural-steel', 'Structural steel packages, connections and ancillary fabrication supplied from engineer or fabrication information.', true, 'category_bespoke_metal_fabrication', 109, now(), now()),
  ('category_aluminium_pressings', 'Aluminium pressings', 'aluminium-pressings', 'Bespoke folded aluminium flashings, trims, cappings and pressings, including gauge, dimensions and finish.', true, 'category_bespoke_metal_fabrication', 110, now(), now()),
  ('category_powder_coated_components', 'Powder-coated components', 'powder-coated-components', 'Fabricated metal components requiring a specified powder-coat system, colour, gloss level and preparation.', true, 'category_bespoke_metal_fabrication', 111, now(), now()),
  ('category_garage_doors', 'Garage doors', 'garage-doors', 'Up-and-over, side-hinged, roller and sectional garage doors, including opening size, access and operation.', true, 'category_specialist_doors', 201, now(), now()),
  ('category_roller_shutters', 'Roller shutters', 'roller-shutters', 'Manual and powered roller shutters, including opening, curtain, controls, security and access requirements.', true, 'category_specialist_doors', 202, now(), now()),
  ('category_sectional_doors', 'Sectional doors', 'sectional-doors', 'Domestic and industrial sectional overhead doors, including headroom, tracks, operation and insulation.', true, 'category_specialist_doors', 203, now(), now()),
  ('category_fire_doors', 'Fire doors', 'fire-doors', 'Certified fire-resisting doorsets requiring verified rating, compatible hardware, product data and installation context.', false, 'category_specialist_doors', 204, now(), now()),
  ('category_communal_entrance_doors', 'Communal entrance doors', 'communal-entrance-doors', 'Secure communal entrance doorsets, including access control, glazing, ironmongery and duty-cycle requirements.', true, 'category_specialist_doors', 205, now(), now()),
  ('category_automatic_doors', 'Automatic doors', 'automatic-doors', 'Automatic sliding, swing and folding entrance systems, including power, sensors, access and survey requirements.', true, 'category_specialist_doors', 206, now(), now()),
  ('category_steel_security_doors', 'Steel security doors', 'steel-security-doors', 'Steel security doorsets, including certification, rating, frame, hardware and installation requirements.', true, 'category_specialist_doors', 207, now(), now()),
  ('category_shopfronts', 'Shopfronts', 'shopfronts', 'Aluminium, steel and glazed shopfront systems, including entrance doors, glass, finish and site access.', true, 'category_specialist_doors', 208, now(), now())
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  "parentId" = EXCLUDED."parentId",
  "displayOrder" = EXCLUDED."displayOrder",
  "updatedAt" = now();

-- These broad legacy roots no longer own any launch products. Keeping them
-- offline prevents a generic server query from accidentally exposing them.
UPDATE bridge_ai."ProductCategory"
SET active = false, "updatedAt" = now()
WHERE id IN (
  'category_doors', 'category_conservatories', 'category_roofing',
  'category_building_materials', 'category_other_building_products'
);

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_future_product_catalogues_staged_v1',
  'SYSTEM.FUTURE_PRODUCT_CATALOGUES_STAGED',
  'ProductCategory',
  NULL,
  'Future product catalogues staged without public launch',
  jsonb_build_object(
    'groups', jsonb_build_array(
      'bespoke-metal-fabrication',
      'garage-industrial-specialist-doors'
    ),
    'launched', false,
    'fireDoorsEnabled', false,
    'fireDoorControl', 'Requires certification and product-data workflow before administrator enablement'
  ),
  now()
)
ON CONFLICT (id) DO NOTHING;
