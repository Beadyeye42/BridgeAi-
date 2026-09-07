UPDATE bridge_ai."QuoteRequest" request
SET
  "matchingPostcode" = (regexp_match(
    request.summary,
    '(?i)(?:collection(?:\s+postcode)?|collect(?:ed)?\s+from|pick[- ]?up(?:\s+from)?)\D{0,30}?(GIR\s?0AA|[A-PR-UWYZ][A-HK-Y]?[0-9][A-Z0-9]?\s?[0-9][ABD-HJLNP-UW-Z]{2})'
  ))[1],
  "matchingLatitude" = NULL,
  "matchingLongitude" = NULL,
  "matchingCoveragePurpose" = 'DELIVERY'::bridge_ai."CoveragePurpose"
FROM bridge_ai."ProductCategory" category
LEFT JOIN bridge_ai."ProductCategory" parent ON parent.id = category."parentId"
WHERE category.id = request."categoryId"
  AND (
    category.slug IN (
      'transport-delivery-removals', 'man-with-a-van', 'trade-collection-delivery',
      'same-day-courier', 'furniture-small-removals', 'bulky-item-transport',
      'building-material-deliveries', 'multi-drop-delivery'
    )
    OR parent.slug = 'transport-delivery-removals'
  )
  AND (regexp_match(
    request.summary,
    '(?i)(?:collection(?:\s+postcode)?|collect(?:ed)?\s+from|pick[- ]?up(?:\s+from)?)\D{0,30}?(GIR\s?0AA|[A-PR-UWYZ][A-HK-Y]?[0-9][A-Z0-9]?\s?[0-9][ABD-HJLNP-UW-Z]{2})'
  ))[1] IS NOT NULL;
