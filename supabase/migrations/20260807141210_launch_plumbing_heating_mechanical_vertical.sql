-- Launch Plumbing, Heating and Mechanical as a first-class industry vertical.
-- The root remains the administrator's launch switch; its child products are
-- the exact matching categories suppliers select and customers are routed to.
INSERT INTO bridge_ai."ProductCategory" (
  id, name, slug, description, active, "parentId", "displayOrder", "createdAt", "updatedAt"
) VALUES (
  'category_plumbing_heating_mechanical',
  'Plumbing, heating and mechanical',
  'plumbing-heating-mechanical',
  'Plumbing, heating and mechanical products and packages, including drawing-led and schedule-led procurement.',
  true, NULL, 300, now(), now()
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = true,
  "parentId" = NULL,
  "displayOrder" = EXCLUDED."displayOrder",
  "updatedAt" = now();

INSERT INTO bridge_ai."ProductCategory" (
  id, name, slug, description, active, "parentId", "displayOrder", "createdAt", "updatedAt"
) VALUES
  ('category_boilers_heating_packages', 'Boilers and heating packages', 'boilers-heating-packages', 'Gas, oil, electric and hybrid boiler packages, controls, flues and associated components.', true, 'category_plumbing_heating_mechanical', 301, now(), now()),
  ('category_heat_pumps', 'Heat pumps', 'heat-pumps', 'Air-source, ground-source and hybrid heat-pump equipment, cylinders, controls and ancillary packages.', true, 'category_plumbing_heating_mechanical', 302, now(), now()),
  ('category_cylinders_hot_water_storage', 'Cylinders and hot-water storage', 'cylinders-hot-water-storage', 'Vented and unvented cylinders, thermal stores, buffer vessels and hot-water storage products.', true, 'category_plumbing_heating_mechanical', 303, now(), now()),
  ('category_underfloor_heating', 'Underfloor heating', 'underfloor-heating', 'Wet and electric underfloor-heating systems, manifolds, controls, pipework and floor build-up components.', true, 'category_plumbing_heating_mechanical', 304, now(), now()),
  ('category_radiators_emitters', 'Radiators and heat emitters', 'radiators-heat-emitters', 'Panel and designer radiators, towel rails, trench heaters, fan convectors and associated valves.', true, 'category_plumbing_heating_mechanical', 305, now(), now()),
  ('category_pipework_fittings', 'Pipework and fittings', 'pipework-fittings', 'Copper, plastic, multilayer, steel and stainless pipework systems, fittings and supports.', true, 'category_plumbing_heating_mechanical', 306, now(), now()),
  ('category_valves_controls', 'Valves and heating controls', 'valves-heating-controls', 'Isolation, control, balancing and mixing valves, TRVs, actuators, thermostats and control packages.', true, 'category_plumbing_heating_mechanical', 307, now(), now()),
  ('category_pumps_pressurisation', 'Pumps and pressurisation', 'pumps-pressurisation', 'Circulators, booster sets, pressurisation units, expansion vessels and condensate pumps.', true, 'category_plumbing_heating_mechanical', 308, now(), now()),
  ('category_mechanical_plant_packages', 'Mechanical plant and packaged systems', 'mechanical-plant-packages', 'Schedule-led mechanical plant, packaged heating systems and coordinated equipment procurement.', true, 'category_plumbing_heating_mechanical', 309, now(), now())
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  "parentId" = EXCLUDED."parentId",
  "displayOrder" = EXCLUDED."displayOrder",
  "updatedAt" = now();

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_plumbing_heating_mechanical_launch_v1',
  'SYSTEM.PRODUCT_CATALOGUE_LAUNCHED',
  'ProductCategory',
  'category_plumbing_heating_mechanical',
  'Plumbing, heating and mechanical catalogue launched',
  jsonb_build_object(
    'launchRoot', 'plumbing-heating-mechanical',
    'products', jsonb_build_array(
      'boilers-heating-packages', 'heat-pumps', 'cylinders-hot-water-storage',
      'underfloor-heating', 'radiators-heat-emitters', 'pipework-fittings',
      'valves-heating-controls', 'pumps-pressurisation', 'mechanical-plant-packages'
    )
  ),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- A customer selection is final. Repair any legacy losing records and close
-- every non-winning supplier route so a late browser/API request cannot quote.
UPDATE bridge_ai."SupplierQuotation" quotation
SET status = 'REJECTED',
    "decidedAt" = GREATEST(
      quotation."submittedAt",
      COALESCE(quotation."decidedAt", request."closedAt", now())
    ),
    "updatedAt" = now()
FROM bridge_ai."QuoteRequest" request
WHERE quotation."quoteRequestId" = request.id
  AND request.status = 'WON'
  AND quotation.status <> 'ACCEPTED';

UPDATE bridge_ai."SupplierAssignment" assignment
SET status = 'WITHDRAWN',
    "respondedAt" = COALESCE(assignment."respondedAt", request."closedAt", now())
FROM bridge_ai."QuoteRequest" request
WHERE assignment."quoteRequestId" = request.id
  AND request.status = 'WON'
  AND NOT EXISTS (
    SELECT 1
    FROM bridge_ai."SupplierQuotation" quotation
    WHERE quotation."assignmentId" = assignment.id
      AND quotation.status = 'ACCEPTED'
  )
  AND assignment.status <> 'WITHDRAWN';

CREATE OR REPLACE FUNCTION bridge_private.enforce_open_request_for_quotation_submission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  request_status bridge_ai."QuoteRequestStatus";
  response_due_at timestamptz;
BEGIN
  IF NEW.status <> 'SUBMITTED' THEN
    RETURN NEW;
  END IF;

  SELECT request.status, request."responseDueAt"
  INTO request_status, response_due_at
  FROM bridge_ai."QuoteRequest" request
  WHERE request.id = NEW."quoteRequestId"
  FOR KEY SHARE;

  IF request_status IS NULL THEN
    RAISE EXCEPTION 'QUOTE_REQUEST_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
  IF request_status NOT IN ('OPEN', 'MATCHING', 'QUOTED') OR response_due_at <= now() THEN
    RAISE EXCEPTION 'QUOTE_REQUEST_CLOSED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_quotation_open_request_guard ON bridge_ai."SupplierQuotation";
CREATE TRIGGER supplier_quotation_open_request_guard
BEFORE INSERT OR UPDATE OF status, "quoteRequestId" ON bridge_ai."SupplierQuotation"
FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_open_request_for_quotation_submission();

REVOKE ALL ON FUNCTION bridge_private.enforce_open_request_for_quotation_submission() FROM PUBLIC;

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'audit_closed_request_quotation_guard_v1',
  'SYSTEM.QUOTATION_CLOSURE_GUARD_ENABLED',
  'SupplierQuotation',
  NULL,
  'Closed requests now reject late supplier quotation submissions',
  jsonb_build_object('closedStatuses', jsonb_build_array('WON', 'LOST', 'EXPIRED', 'CANCELLED')),
  now()
)
ON CONFLICT (id) DO NOTHING;
