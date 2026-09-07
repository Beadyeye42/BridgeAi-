BEGIN;

UPDATE bridge_ai."ProductCategory"
SET
  name = 'House, garage, loft & office clearance',
  description = 'Photo-led property and waste clearance, excluding garden work.',
  "updatedAt" = now()
WHERE slug = 'property-clearance';

UPDATE bridge_ai."ProductCategory"
SET
  description = 'Garden overgrowth, garden waste and access-led clearance.',
  "updatedAt" = now()
WHERE slug = 'garden-clearance';

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_hyperlocal_clearance_routing_v1',
  'SYSTEM.HYPERLOCAL_CLEARANCE_ROUTING_CLARIFIED',
  'ProductCategory',
  NULL,
  'Garden clearance separated from indoor and commercial property clearance',
  jsonb_build_object(
    'propertyClearance', jsonb_build_array('house', 'garage', 'loft', 'office'),
    'gardenClearance', jsonb_build_array('garden', 'garden waste', 'overgrowth')
  ),
  now()
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
