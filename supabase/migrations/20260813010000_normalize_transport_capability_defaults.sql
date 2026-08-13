UPDATE bridge_ai."SupplierCapability" capability
SET
  "standardLeadTimeDays" = CASE
    WHEN capability."standardLeadTimeDays" = 14
      AND capability."currentLeadTimeDays" IS NULL
      AND capability."urgentLeadTimeDays" IS NULL
    THEN 1
    ELSE capability."standardLeadTimeDays"
  END,
  "currentLeadTimeDays" = CASE
    WHEN capability."standardLeadTimeDays" = 14
      AND capability."currentLeadTimeDays" IS NULL
      AND capability."urgentLeadTimeDays" IS NULL
    THEN 1
    ELSE capability."currentLeadTimeDays"
  END,
  "urgentLeadTimeDays" = CASE
    WHEN capability."standardLeadTimeDays" = 14
      AND capability."currentLeadTimeDays" IS NULL
      AND capability."urgentLeadTimeDays" IS NULL
    THEN 1
    ELSE capability."urgentLeadTimeDays"
  END,
  "servesConsumer" = true,
  "supportsDelivery" = true,
  "supportsService" = true,
  "updatedAt" = now()
FROM bridge_ai."ProductCategory" category
LEFT JOIN bridge_ai."ProductCategory" parent ON parent.id = category."parentId"
WHERE capability."productCategoryId" = category.id
  AND capability.active
  AND (
    category.slug IN (
      'transport-delivery-removals', 'man-with-a-van', 'trade-collection-delivery',
      'same-day-courier', 'furniture-small-removals', 'bulky-item-transport',
      'building-material-deliveries', 'multi-drop-delivery'
    )
    OR parent.slug = 'transport-delivery-removals'
  );
