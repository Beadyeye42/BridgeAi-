-- Keep the administrator launch screen focused on first-class industries.
-- Legacy broad roots are retained for historical references but are no longer
-- presented as launchable industry workspaces.
ALTER TABLE bridge_ai."ProductCategory"
  ADD COLUMN IF NOT EXISTS "adminVisible" boolean NOT NULL DEFAULT true;

UPDATE bridge_ai."ProductCategory"
SET "adminVisible" = false,
    active = false,
    "updatedAt" = now()
WHERE "parentId" IS NULL
  AND id IN (
    'category_doors',
    'category_conservatories',
    'category_roofing',
    'category_building_materials',
    'category_other_building_products'
  );

UPDATE bridge_ai."ProductCategory"
SET "adminVisible" = true,
    "updatedAt" = now()
WHERE "parentId" IS NULL
  AND id IN (
    'category_windows',
    'category_bespoke_metal_fabrication',
    'category_specialist_doors',
    'category_plumbing_heating_mechanical'
  );

CREATE INDEX IF NOT EXISTS "ProductCategory_adminVisible_parentId_displayOrder_idx"
  ON bridge_ai."ProductCategory" ("adminVisible", "parentId", "displayOrder");

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_industry_admin_simplified_v1',
  'SYSTEM.INDUSTRY_ADMIN_SIMPLIFIED',
  'ProductCategory',
  NULL,
  'Administrator catalogue simplified to first-class industry workspaces',
  jsonb_build_object(
    'visibleIndustries', jsonb_build_array(
      'windows',
      'bespoke-metal-fabrication',
      'garage-industrial-specialist-doors',
      'plumbing-heating-mechanical'
    ),
    'hiddenLegacyRoots', jsonb_build_array(
      'doors',
      'conservatories-extensions',
      'roofing',
      'building-materials',
      'other-building-products'
    ),
    'recordsDeleted', false
  ),
  now()
)
ON CONFLICT (id) DO NOTHING;
