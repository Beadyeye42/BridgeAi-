-- Bridge AI launches with one focused trade catalogue. Reuse the existing
-- Windows record as the stable root so live requests and supplier selections
-- remain valid while the visible catalogue becomes more precise.
UPDATE bridge_ai."ProductCategory"
SET name = 'Windows, doors and glazing',
    description = 'Launch catalogue for windows, doors, glazing, roof glass and associated replacement products.',
    active = true,
    "parentId" = NULL,
    "displayOrder" = 10,
    "updatedAt" = now()
WHERE id = 'category_windows';

-- Preserve stable identifiers for categories that already carry live data,
-- while widening their supplier-facing names to the requested product groups.
UPDATE bridge_ai."ProductCategory"
SET name = CASE id
      WHEN 'category_upvc_windows' THEN 'uPVC windows and doors'
      WHEN 'category_aluminium_windows' THEN 'Aluminium windows and bifolds'
      WHEN 'category_timber_windows' THEN 'Timber windows and doors'
      WHEN 'category_patio_sliders' THEN 'Patio and French doors'
      WHEN 'category_roof_lanterns' THEN 'Roof lanterns'
      ELSE name
    END,
    description = CASE id
      WHEN 'category_upvc_windows' THEN 'uPVC windows, entrance doors, back doors and French doors, including replacement work.'
      WHEN 'category_aluminium_windows' THEN 'Aluminium windows, entrance doors, French doors and bifolding door systems.'
      WHEN 'category_timber_windows' THEN 'Timber and timber-look windows, entrance doors and external door systems.'
      WHEN 'category_patio_sliders' THEN 'Patio sliders, inline and lift-and-slide doors, plus French door sets in any material.'
      WHEN 'category_roof_lanterns' THEN 'Glazed roof lantern systems, including frame, glass and finish requirements.'
      ELSE description
    END,
    "parentId" = 'category_windows',
    "updatedAt" = now()
WHERE id IN (
  'category_upvc_windows', 'category_aluminium_windows',
  'category_timber_windows', 'category_composite_doors',
  'category_patio_sliders', 'category_conservatory_systems',
  'category_roof_lanterns', 'category_juliet_balconies'
);

INSERT INTO bridge_ai."ProductCategory" (
  id, name, slug, description, active, "parentId", "displayOrder", "createdAt", "updatedAt"
) VALUES
  ('category_vertical_sliders', 'Vertical sliders', 'vertical-sliders', 'Sliding sash windows in uPVC, aluminium or timber, including replacement and heritage-style systems.', true, 'category_windows', 15, now(), now()),
  ('category_glass_units', 'Glass units', 'glass-units', 'Sealed and insulated glass units (IGUs), including pane build-up, spacer, gas, coating and delivery requirements.', true, 'category_windows', 17, now(), now()),
  ('category_toughened_laminated_glass', 'Toughened and laminated glass', 'toughened-laminated-glass', 'Safety glass and specialist sealed units using toughened or laminated panes, including 6.4 mm and 6.8 mm laminate specifications.', true, 'category_windows', 18, now(), now()),
  ('category_mirrors_splashbacks', 'Mirrors and splashbacks', 'mirrors-splashbacks', 'Made-to-measure mirrors and glass splashbacks, including cut-outs, polished edges, colour and fixing requirements.', true, 'category_windows', 19, now(), now()),
  ('category_replacement_mismeasured_units', 'Replacement and miss-measured units', 'replacement-mismeasured-units', 'Replacement frames, doors and glass, including correctly specified surplus or miss-measured units.', true, 'category_windows', 20, now(), now()),
  ('category_roof_glass', 'Rooflights and flat-roof glass', 'roof-glass', 'Flat-roof glass, rooflights and stepped glass units using internal opening sizes, material and finish.', true, 'category_windows', 21, now(), now())
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = true,
  "parentId" = EXCLUDED."parentId",
  "displayOrder" = EXCLUDED."displayOrder",
  "updatedAt" = now();

UPDATE bridge_ai."ProductCategory"
SET "displayOrder" = CASE id
      WHEN 'category_upvc_windows' THEN 11
      WHEN 'category_aluminium_windows' THEN 12
      WHEN 'category_composite_doors' THEN 13
      WHEN 'category_patio_sliders' THEN 14
      WHEN 'category_roof_lanterns' THEN 16
      WHEN 'category_timber_windows' THEN 22
      WHEN 'category_conservatory_systems' THEN 23
      WHEN 'category_juliet_balconies' THEN 24
      ELSE "displayOrder"
    END,
    "updatedAt" = now()
WHERE id IN (
  'category_upvc_windows', 'category_aluminium_windows',
  'category_composite_doors', 'category_patio_sliders',
  'category_roof_lanterns', 'category_timber_windows',
  'category_conservatory_systems', 'category_juliet_balconies'
);

-- Merge selections from superseded overlapping categories before hiding them.
INSERT INTO bridge_ai."SupplierProductCategory" (
  "supplierCompanyId", "productCategoryId", "createdAt"
)
SELECT selection."supplierCompanyId", mapping.target_id, now()
FROM bridge_ai."SupplierProductCategory" selection
JOIN (VALUES
  ('category_upvc_doors', 'category_upvc_windows'),
  ('category_aluminium_doors', 'category_aluminium_windows'),
  ('category_bifold_doors', 'category_aluminium_windows'),
  ('category_timber_doors', 'category_timber_windows')
) AS mapping(source_id, target_id)
  ON mapping.source_id = selection."productCategoryId"
ON CONFLICT ("supplierCompanyId", "productCategoryId") DO NOTHING;

-- Existing live requests are reclassified only where the old category maps
-- unambiguously to the consolidated product group.
UPDATE bridge_ai."QuoteRequest"
SET "categoryId" = CASE "categoryId"
      WHEN 'category_upvc_doors' THEN 'category_upvc_windows'
      WHEN 'category_aluminium_doors' THEN 'category_aluminium_windows'
      WHEN 'category_bifold_doors' THEN 'category_aluminium_windows'
      WHEN 'category_timber_doors' THEN 'category_timber_windows'
      ELSE "categoryId"
    END,
    "updatedAt" = now()
WHERE "categoryId" IN (
  'category_upvc_doors', 'category_aluminium_doors',
  'category_bifold_doors', 'category_timber_doors'
);

UPDATE bridge_ai."QuoteRequest"
SET "categoryId" = 'category_aluminium_windows', "updatedAt" = now()
WHERE "categoryId" = 'category_doors'
  AND title ILIKE '%aluminium%'
  AND title ILIKE '%bifold%';

UPDATE bridge_ai."SupplierOpportunity" opportunity
SET "categoryId" = request."categoryId", "updatedAt" = now()
FROM bridge_ai."QuoteRequest" request
WHERE opportunity."quoteRequestId" = request.id
  AND opportunity."categoryId" <> request."categoryId";

UPDATE bridge_ai."ProductCategory"
SET active = false, "updatedAt" = now()
WHERE id IN (
  'category_doors', 'category_upvc_doors', 'category_aluminium_doors',
  'category_timber_doors', 'category_bifold_doors'
);

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_windows_doors_glazing_launch_v1',
  'SYSTEM.PRODUCT_CATALOGUE_LAUNCHED',
  'ProductCategory',
  'category_windows',
  'Windows, doors and glazing launch catalogue activated',
  jsonb_build_object(
    'launchRoot', 'windows',
    'newSlugs', jsonb_build_array(
      'vertical-sliders', 'glass-units', 'toughened-laminated-glass',
      'mirrors-splashbacks', 'replacement-mismeasured-units', 'roof-glass'
    ),
    'supersededSlugs', jsonb_build_array(
      'doors', 'upvc-doors', 'aluminium-doors', 'timber-doors', 'bifold-doors'
    )
  ),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- Keep marketplace claiming consistent with server-side automatic matching:
-- an exact category match is valid, and a parent selection covers its child
-- (or a broad parent request can be served by a selected child).
CREATE OR REPLACE FUNCTION bridge_private.claim_supplier_opportunity(
  target_reference text,
  target_company_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := (SELECT auth.uid());
  request_row bridge_ai."QuoteRequest"%ROWTYPE;
  assignment_id text := 'claim_' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF actor_id IS NULL OR NOT bridge_private.has_company_membership(target_company_id) THEN
    RAISE EXCEPTION 'CLAIM_NOT_AUTHORISED' USING ERRCODE = '42501';
  END IF;

  SELECT request.* INTO request_row
  FROM bridge_ai."QuoteRequest" request
  JOIN bridge_ai."SupplierOpportunity" opportunity ON opportunity."quoteRequestId" = request.id
  WHERE opportunity.reference = target_reference
  FOR UPDATE OF request;

  IF request_row.id IS NULL THEN
    RAISE EXCEPTION 'OPPORTUNITY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF request_row.status NOT IN ('OPEN', 'MATCHING', 'QUOTED') OR request_row."responseDueAt" <= now() THEN
    RAISE EXCEPTION 'OPPORTUNITY_CLOSED' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bridge_ai."SupplierAssignment" assignment
    WHERE assignment."quoteRequestId" = request_row.id
      AND assignment."supplierCompanyId" = target_company_id
  ) THEN
    SELECT assignment.id INTO assignment_id
    FROM bridge_ai."SupplierAssignment" assignment
    WHERE assignment."quoteRequestId" = request_row.id
      AND assignment."supplierCompanyId" = target_company_id;
    RETURN assignment_id;
  END IF;
  IF (SELECT count(*) FROM bridge_ai."SupplierAssignment" assignment
      WHERE assignment."quoteRequestId" = request_row.id AND assignment.status <> 'WITHDRAWN') >= LEAST(request_row."distributionLimit", 5) THEN
    RAISE EXCEPTION 'OPPORTUNITY_FULL' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM bridge_ai.supplier_companies company
    JOIN bridge_ai."Subscription" subscription ON subscription."supplierCompanyId" = company.id
    WHERE company.id = target_company_id
      AND company.status = 'APPROVED'
      AND company."foundingMemberNumber" BETWEEN 1 AND 100
      AND subscription.status = 'ACTIVE'
      AND (subscription."currentPeriodEnd" IS NULL OR subscription."currentPeriodEnd" > now())
  ) THEN
    RAISE EXCEPTION 'ACTIVE_FOUNDING_SUBSCRIPTION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM bridge_ai."SupplierProductCategory" selection
    JOIN bridge_ai."ProductCategory" selected
      ON selected.id = selection."productCategoryId"
    JOIN bridge_ai."ProductCategory" requested
      ON requested.id = request_row."categoryId"
    WHERE selection."supplierCompanyId" = target_company_id
      AND (
        selected.id = requested.id
        OR selected.id = requested."parentId"
        OR selected."parentId" = requested.id
      )
  ) THEN
    RAISE EXCEPTION 'CATEGORY_NOT_MATCHED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM bridge_ai."CoverageArea" coverage
    WHERE coverage."supplierCompanyId" = target_company_id
      AND coverage.active
      AND (
        coverage.type = 'NATIONWIDE'
        OR (
          coverage.type = 'POSTCODE'
          AND upper(regexp_replace(request_row."deliveryPostcode", '\\s', '', 'g'))
              LIKE upper(regexp_replace(coverage."postcodePrefix", '\\s', '', 'g')) || '%'
        )
        OR (
          coverage.type = 'DISTANCE'
          AND request_row."deliveryLatitude" IS NOT NULL
          AND request_row."deliveryLongitude" IS NOT NULL
          AND coverage.latitude IS NOT NULL
          AND coverage.longitude IS NOT NULL
          AND coverage."radiusMiles" IS NOT NULL
          AND 3958.7613 * acos(least(1, greatest(-1,
            sin(radians(coverage.latitude::double precision)) * sin(radians(request_row."deliveryLatitude"::double precision))
            + cos(radians(coverage.latitude::double precision)) * cos(radians(request_row."deliveryLatitude"::double precision))
            * cos(radians(request_row."deliveryLongitude"::double precision - coverage.longitude::double precision))
          ))) <= coverage."radiusMiles"
        )
      )
  ) THEN
    RAISE EXCEPTION 'COVERAGE_NOT_MATCHED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO bridge_ai."SupplierAssignment" (
    id, "quoteRequestId", "supplierCompanyId", status,
    "assignedAt", "expiresAt", "assignedById"
  ) VALUES (
    assignment_id, request_row.id, target_company_id, 'ACCEPTED',
    now(), request_row."responseDueAt", actor_id
  );
  UPDATE bridge_ai."QuoteRequest"
  SET status = 'MATCHING', "updatedAt" = now()
  WHERE id = request_row.id AND status = 'OPEN';
  INSERT INTO bridge_ai."AuditLog" (
    id, "actorUserId", "supplierCompanyId", action, "entityType",
    "entityId", summary, metadata, "createdAt"
  ) VALUES (
    'audit_' || replace(gen_random_uuid()::text, '-', ''),
    actor_id, target_company_id, 'OPPORTUNITY.CLAIMED',
    'SupplierAssignment', assignment_id,
    'Subscribed founding supplier claimed an opportunity slot',
    jsonb_build_object('quoteRequestId', request_row.id, 'reference', request_row.reference),
    now()
  );
  RETURN assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.claim_supplier_opportunity(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION bridge_private.claim_supplier_opportunity(text, text)
  TO bridge_ai_app;
