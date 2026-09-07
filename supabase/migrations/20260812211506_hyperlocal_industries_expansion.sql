CREATE TYPE bridge_ai."LiveAvailabilityStatus" AS ENUM (
  'AVAILABLE_NOW', 'AVAILABLE_TODAY', 'AVAILABLE_TOMORROW', 'LIMITED', 'FULLY_BOOKED', 'PAUSED', 'HOLIDAY'
);
CREATE TYPE bridge_ai."RequestUrgency" AS ENUM (
  'EMERGENCY', 'WITHIN_2_HOURS', 'SAME_DAY', 'NEXT_DAY', 'THIS_WEEK', 'FLEXIBLE', 'FUTURE_BOOKING'
);
CREATE TYPE bridge_ai."RecurrenceCadence" AS ENUM ('ONE_OFF', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY');

ALTER TABLE bridge_ai."Conversation"
  DROP CONSTRAINT IF EXISTS conversation_ai_question_key_valid,
  ADD CONSTRAINT conversation_ai_question_key_valid CHECK (
    "aiLastQuestionKey" IS NULL OR "aiLastQuestionKey" IN (
      'PREFERRED_NAME', 'QUOTE_OFFER', 'INDUSTRY', 'BUYER_TYPE', 'PRODUCT',
      'DELIVERY_POSTCODE', 'REQUIRED_BY', 'FULFILMENT', 'CATEGORY',
      'COMPOSITE_STYLE', 'ROOF_GLAZING_SPECIFICATION', 'PHE_SPECIFICATION',
      'TRANSPORT_ROUTE_ITEM', 'TRANSPORT_ACCESS', 'TRANSPORT_HANDLING',
      'HYPERLOCAL_SERVICE', 'SPECIFICATION', 'REQUIREMENTS', 'NONE'
    )
  );

ALTER TABLE bridge_ai."SupplierCapability"
  ADD COLUMN "liveAvailability" bridge_ai."LiveAvailabilityStatus" NOT NULL DEFAULT 'AVAILABLE_TODAY',
  ADD COLUMN "nextAvailableAt" timestamptz,
  ADD COLUMN "availabilityLastConfirmedAt" timestamptz NOT NULL DEFAULT now();

ALTER TABLE bridge_ai."QuoteRequest"
  ADD COLUMN urgency bridge_ai."RequestUrgency" NOT NULL DEFAULT 'FLEXIBLE',
  ADD COLUMN "preferredTime" varchar(80),
  ADD COLUMN "recurrenceCadence" bridge_ai."RecurrenceCadence" NOT NULL DEFAULT 'ONE_OFF',
  ADD COLUMN "qualificationData" jsonb,
  ADD COLUMN "attachmentExtractionConfidence" numeric(5,4),
  ADD COLUMN "previousQuoteRequestId" text,
  ADD COLUMN "previousSupplierCompanyId" text,
  ADD CONSTRAINT "QuoteRequest_previousQuoteRequestId_fkey"
    FOREIGN KEY ("previousQuoteRequestId") REFERENCES bridge_ai."QuoteRequest"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "QuoteRequest_attachmentExtractionConfidence_check"
    CHECK ("attachmentExtractionConfidence" IS NULL OR "attachmentExtractionConfidence" BETWEEN 0 AND 1);

CREATE INDEX "SupplierCapability_productCategoryId_active_liveAvailability_availabilityLastConfirmedAt_idx"
  ON bridge_ai."SupplierCapability" ("productCategoryId", active, "liveAvailability", "availabilityLastConfirmedAt");
CREATE INDEX "QuoteRequest_urgency_status_responseDueAt_idx"
  ON bridge_ai."QuoteRequest" (urgency, status, "responseDueAt");
CREATE INDEX "QuoteRequest_previousQuoteRequestId_idx"
  ON bridge_ai."QuoteRequest" ("previousQuoteRequestId");

WITH industries(id, name, slug, description, display_order) AS (VALUES
  ('industry_automotive_mobile', 'Automotive & Mobile Vehicle Services', 'automotive-mobile-services', 'Mobile and workshop vehicle repair, diagnostics, tyres, recovery and bodywork.', 40),
  ('industry_plumbing_local', 'Plumbing, Heating & Drainage', 'plumbing-heating-drainage', 'Local plumbing, drainage, boiler, heating and HVAC services.', 50),
  ('industry_cleaning_property', 'Cleaning, Clearance & Property Care', 'cleaning-clearance-property-care', 'Domestic, commercial and repeat cleaning plus compliant property clearance.', 60),
  ('industry_garden_outdoor', 'Garden & Outdoor Services', 'garden-outdoor-services', 'Garden maintenance, clearance, trees, fencing, landscaping and outdoor work.', 70),
  ('industry_appliance_repair', 'Appliance Repair & Home Equipment', 'appliance-repair-home-equipment', 'Local appliance diagnostics, repair, installation and disconnection.', 80),
  ('industry_locksmith_security', 'Locksmith, Security & Access', 'locksmith-security-access', 'Emergency locksmith, scheduled lock, CCTV, alarm and access-control work.', 90)
)
INSERT INTO bridge_ai."ProductCategory" (
  id, name, slug, description, active, "adminVisible", "hyperlocalEnabled",
  "servesConsumer", "servesTrade", "servesBusiness", "displayOrder", "createdAt", "updatedAt"
)
SELECT id, name, slug, description, true, true, true, true,
  CASE WHEN slug = 'appliance-repair-home-equipment' THEN false ELSE true END,
  true, display_order, now(), now()
FROM industries
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  "hyperlocalEnabled" = true,
  "servesConsumer" = EXCLUDED."servesConsumer",
  "servesTrade" = EXCLUDED."servesTrade",
  "servesBusiness" = EXCLUDED."servesBusiness",
  "adminVisible" = true,
  "updatedAt" = now();

WITH services(industry_slug, service_slug, name, description, display_order) AS (VALUES
  ('automotive-mobile-services','mobile-mechanic','Mobile mechanic','Mobile vehicle diagnosis and repair.',1),
  ('automotive-mobile-services','vehicle-diagnostics','Vehicle diagnostics','Car, van and mobile diagnostics.',2),
  ('automotive-mobile-services','mobile-tyre-fitting','Mobile tyre fitting','Puncture and tyre replacement at the vehicle.',3),
  ('automotive-mobile-services','battery-jump-start','Battery replacement & jump start','Battery diagnosis, replacement and jump starts.',4),
  ('automotive-mobile-services','vehicle-electrical','Auto electrical faults','Alternator, starter and vehicle electrical diagnosis.',5),
  ('automotive-mobile-services','breakdown-recovery','Breakdown, recovery & towing','Emergency assistance, recovery and towing.',6),
  ('automotive-mobile-services','vehicle-air-conditioning','Vehicle air-conditioning','Vehicle AC diagnosis, repair and recharge.',7),
  ('automotive-mobile-services','brakes-servicing-mot','Brakes, servicing & MOT preparation','Brakes, routine servicing and MOT preparation.',8),
  ('automotive-mobile-services','smart-bodywork','SMART, dent, scratch & bumper repair','Mobile and workshop cosmetic body repair.',9),
  ('automotive-mobile-services','alloy-wheel-repair','Alloy wheel repair','Alloy wheel repair and refurbishment.',10),
  ('automotive-mobile-services','windscreen-repair','Windscreen repair & replacement','Windscreen chips, cracks and replacement.',11),
  ('automotive-mobile-services','vehicle-transport','Vehicle transport','Planned vehicle collection and transport.',12),
  ('plumbing-heating-drainage','emergency-plumbing','Emergency plumber','Active leaks, burst pipes and urgent plumbing.',1),
  ('plumbing-heating-drainage','general-plumbing','General plumbing repairs','Taps, toilets, showers and water pressure.',2),
  ('plumbing-heating-drainage','drain-clearance','Blocked drains & drain clearance','Blockages, clearance and drain inspection.',3),
  ('plumbing-heating-drainage','boiler-repair','Boiler breakdown, repair & service','Boiler faults, servicing, heating and hot water.',4),
  ('plumbing-heating-drainage','boiler-replacement','Boiler replacement','Replacement boiler design and installation.',5),
  ('plumbing-heating-drainage','heating-radiators','Heating, radiators & thermostats','Heating faults, radiators, controls and underfloor heating.',6),
  ('plumbing-heating-drainage','hot-water-cylinder','Hot-water cylinder','Cylinder repairs, replacement and installation.',7),
  ('plumbing-heating-drainage','commercial-plumbing-heating','Commercial plumbing & heating','Commercial site plumbing and heating.',8),
  ('plumbing-heating-drainage','hvac-air-conditioning','Air conditioning & HVAC','Commercial and domestic HVAC where qualified.',9),
  ('cleaning-clearance-property-care','domestic-cleaning','Domestic & regular cleaning','One-off and recurring domestic cleaning.',1),
  ('cleaning-clearance-property-care','deep-end-tenancy-cleaning','Deep, move & end-of-tenancy cleaning','Deep, move-in, move-out and tenancy cleans.',2),
  ('cleaning-clearance-property-care','commercial-airbnb-cleaning','Office, commercial & short-let cleaning','Recurring and turnaround commercial cleaning.',3),
  ('cleaning-clearance-property-care','specialist-cleaning','Carpet, upholstery, oven & window cleaning','Specialist interior and window cleaning.',4),
  ('cleaning-clearance-property-care','exterior-cleaning','Gutter, pressure, driveway & patio cleaning','Exterior property cleaning.',5),
  ('cleaning-clearance-property-care','after-build-cleaning','After-build cleaning','Post-construction and builders cleans.',6),
  ('cleaning-clearance-property-care','property-clearance','House, garage, loft, garden & office clearance','Photo-led property and waste clearance.',7),
  ('garden-outdoor-services','garden-maintenance','Garden maintenance, lawns & hedges','One-off and recurring garden maintenance.',1),
  ('garden-outdoor-services','garden-clearance','Garden clearance','Overgrowth, garden waste and access-led clearance.',2),
  ('garden-outdoor-services','trees-stumps','Tree work & stump grinding','Tree pruning, removal and stump grinding.',3),
  ('garden-outdoor-services','fencing-decking','Fencing & decking','Fencing and decking installation or repair.',4),
  ('garden-outdoor-services','patios-landscaping','Patios, landscaping & groundworks','Patios, landscaping, drainage and small groundworks.',5),
  ('garden-outdoor-services','turf-artificial-grass','Turf & artificial grass','Natural turf and artificial grass.',6),
  ('garden-outdoor-services','garden-structures','Sheds, raised beds & garden structures','Assembly, removal and construction of garden structures.',7),
  ('appliance-repair-home-equipment','washing-laundry-appliance-repair','Washing machine & tumble dryer repair','Laundry appliance diagnosis and repair.',1),
  ('appliance-repair-home-equipment','dishwasher-repair','Dishwasher repair','Dishwasher diagnosis and repair.',2),
  ('appliance-repair-home-equipment','refrigeration-appliance-repair','Fridge & freezer repair','Domestic refrigeration diagnosis and repair.',3),
  ('appliance-repair-home-equipment','cooking-appliance-repair','Oven, cooker, hob & extractor repair','Cooking appliance diagnosis and repair.',4),
  ('appliance-repair-home-equipment','commercial-appliance-repair','Commercial appliance repair','Commercial appliance diagnostics and repair.',5),
  ('appliance-repair-home-equipment','appliance-installation','Appliance installation & disconnection','Safe installation and disconnection.',6),
  ('locksmith-security-access','emergency-locksmith','Emergency locksmith & lockout','Urgent authorised access and lockouts.',1),
  ('locksmith-security-access','lock-repair-replacement','Lock repair & replacement','Residential and commercial locks.',2),
  ('locksmith-security-access','upvc-multipoint-locks','uPVC & multipoint lock repair','uPVC doors and multipoint mechanisms.',3),
  ('locksmith-security-access','smart-locks-entry-access','Smart locks, door entry & access control','Scheduled electronic access systems.',4),
  ('locksmith-security-access','cctv-alarms-intercom','CCTV, alarms & intercoms','Scheduled security system installation and repair.',5),
  ('locksmith-security-access','security-upgrades','Security upgrades','Property security review and upgrades.',6)
)
INSERT INTO bridge_ai."ProductCategory" (
  id, name, slug, description, active, "adminVisible", "hyperlocalEnabled",
  "servesConsumer", "servesTrade", "servesBusiness", "parentId", "displayOrder", "createdAt", "updatedAt"
)
SELECT 'service_' || replace(service_slug, '-', '_'), services.name, service_slug, services.description,
  true, false, false, parent."servesConsumer", parent."servesTrade", parent."servesBusiness",
  parent.id, display_order, now(), now()
FROM services
JOIN bridge_ai."ProductCategory" parent ON parent.slug = services.industry_slug
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  "parentId" = EXCLUDED."parentId",
  "servesConsumer" = EXCLUDED."servesConsumer",
  "servesTrade" = EXCLUDED."servesTrade",
  "servesBusiness" = EXCLUDED."servesBusiness",
  "updatedAt" = now();

INSERT INTO bridge_ai."AuditLog" (
  id, action, "entityType", "entityId", summary, metadata, "createdAt"
) VALUES (
  'system_hyperlocal_industries_20260811235611',
  'SYSTEM.HYPERLOCAL_INDUSTRIES_EXPANDED',
  'ProductCategory',
  NULL,
  'Added six configuration-driven Hyperlocal service industries with live availability and repeat-request foundations',
  jsonb_build_object(
    'industryCount', 6,
    'hyperlocalPricePence', 1499,
    'maximumRadiusMiles', 10,
    'maximumSuppliersPerRequest', 5,
    'availabilityStalenessProtected', true,
    'selectionLifecyclePreserved', true
  ),
  now()
) ON CONFLICT (id) DO NOTHING;
