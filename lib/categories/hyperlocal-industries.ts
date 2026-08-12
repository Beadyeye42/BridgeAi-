export type RequestUrgency = "EMERGENCY" | "WITHIN_2_HOURS" | "SAME_DAY" | "NEXT_DAY" | "THIS_WEEK" | "FLEXIBLE" | "FUTURE_BOOKING";

export type HyperlocalServiceDefinition = {
  slug: string;
  name: string;
  aliases: readonly string[];
  requiredInformation: readonly string[];
  optionalInformation: readonly string[];
  photoPrompt?: string;
  capabilities: readonly string[];
  verification: readonly string[];
  matchingWeights: { capability: number; availability: number; location: number; response: number; performance: number };
};

export type HyperlocalIndustryDefinition = {
  slug: string;
  name: string;
  buyerTypes: readonly ("CONSUMER" | "TRADE" | "BUSINESS")[];
  hyperlocal: true;
  services: readonly HyperlocalServiceDefinition[];
};

const urgent = { capability: 30, availability: 30, location: 25, response: 10, performance: 5 } as const;
const specialist = { capability: 40, availability: 20, location: 15, response: 10, performance: 15 } as const;
const scheduled = { capability: 35, availability: 20, location: 20, response: 10, performance: 15 } as const;

function service(
  slug: string,
  name: string,
  aliases: readonly string[],
  requiredInformation: readonly string[],
  capabilities: readonly string[],
  options: Partial<Pick<HyperlocalServiceDefinition, "optionalInformation" | "photoPrompt" | "verification" | "matchingWeights">> = {},
): HyperlocalServiceDefinition {
  return {
    slug,
    name,
    aliases,
    requiredInformation,
    optionalInformation: options.optionalInformation ?? ["photos", "preferred_time", "access", "parking"],
    capabilities,
    verification: options.verification ?? [],
    matchingWeights: options.matchingWeights ?? scheduled,
    photoPrompt: options.photoPrompt,
  };
}

const locationWhen = ["postcode", "required_date", "urgency"] as const;

export const HYPERLOCAL_INDUSTRIES: readonly HyperlocalIndustryDefinition[] = [
  {
    slug: "automotive-mobile-services",
    name: "Automotive & Mobile Vehicle Services",
    buyerTypes: ["CONSUMER", "TRADE", "BUSINESS"],
    hyperlocal: true,
    services: [
      service("mobile-mechanic", "Mobile mechanic", ["mobile mechanic", "mechanic at home", "car repair at home"], [...locationWhen, "vehicle_registration", "symptoms", "driveable"], ["mobile_service", "cars", "vans"], { photoPrompt: "A photo or short video of the vehicle, warning light or damage will help the mechanic prepare." }),
      service("vehicle-diagnostics", "Vehicle diagnostics", ["car diagnostics", "van diagnostics", "mobile diagnostics", "warning light", "engine light"], [...locationWhen, "vehicle_registration", "make_model", "symptoms", "warning_lights"], ["diagnostics", "mobile_service"], { matchingWeights: specialist }),
      service("mobile-tyre-fitting", "Mobile tyre fitting", ["mobile tyre", "tyres fitted", "puncture", "flat tyre", "tyre replacement"], [...locationWhen, "vehicle_registration", "tyre_size", "quantity"], ["tyres", "mobile_service"], { matchingWeights: urgent }),
      service("battery-jump-start", "Battery replacement & jump start", ["flat battery", "battery replacement", "jump start", "won't start", "wont start"], [...locationWhen, "vehicle_registration", "driveable", "symptoms"], ["battery_service", "mobile_service"], { matchingWeights: urgent }),
      service("vehicle-electrical", "Auto electrical faults", ["auto electrician", "vehicle electrical", "alternator", "starter motor", "electrical fault"], [...locationWhen, "vehicle_registration", "symptoms", "warning_lights"], ["auto_electrical", "diagnostics"], { matchingWeights: specialist }),
      service("breakdown-recovery", "Breakdown, recovery & towing", ["breakdown", "vehicle recovery", "car towing", "van recovery", "need towing"], [...locationWhen, "vehicle_registration", "current_location", "driveable", "recovery_destination"], ["recovery", "emergency_service"], { matchingWeights: urgent }),
      service("vehicle-air-conditioning", "Vehicle air-conditioning", ["car air con", "air conditioning recharge", "air con regas", "vehicle ac"], [...locationWhen, "vehicle_registration", "make_model", "symptoms"], ["air_conditioning"], { matchingWeights: specialist }),
      service("brakes-servicing-mot", "Brakes, servicing & MOT preparation", ["brake repair", "car service", "van service", "mot preparation", "servicing"], [...locationWhen, "vehicle_registration", "service_requested"], ["workshop_service", "mobile_service"], { matchingWeights: specialist }),
      service("smart-bodywork", "SMART, dent, scratch & bumper repair", ["dent repair", "scratch repair", "bumper repair", "smart repair", "bodywork", "scraped bumper"], [...locationWhen, "vehicle_registration", "damage_location", "photos"], ["bodywork", "SMART_repairs"], { photoPrompt: "Please send clear photos of the damage from close up and a few steps back.", matchingWeights: specialist }),
      service("alloy-wheel-repair", "Alloy wheel repair", ["alloy repair", "alloy wheel", "wheel refurbishment"], [...locationWhen, "vehicle_registration", "wheel_size", "quantity", "photos"], ["alloy_wheels"], { photoPrompt: "Please send a clear photo of each damaged wheel." }),
      service("windscreen-repair", "Windscreen repair & replacement", ["windscreen chip", "windscreen replacement", "cracked windscreen"], [...locationWhen, "vehicle_registration", "damage_type", "photos"], ["windscreens", "mobile_service"], { matchingWeights: urgent }),
      service("vehicle-transport", "Vehicle transport", ["transport a car", "vehicle transport", "move my car"], [...locationWhen, "vehicle_registration", "collection_postcode", "delivery_postcode", "driveable"], ["vehicle_transport", "recovery"], { matchingWeights: specialist }),
    ],
  },
  {
    slug: "plumbing-heating-drainage",
    name: "Plumbing, Heating & Drainage",
    buyerTypes: ["CONSUMER", "TRADE", "BUSINESS"],
    hyperlocal: true,
    services: [
      service("emergency-plumbing", "Emergency plumber", ["emergency plumber", "burst pipe", "active leak", "water coming through", "flooding"], [...locationWhen, "active_leak", "water_isolated", "property_type"], ["emergency_plumbing", "emergency_callout"], { photoPrompt: "If it is safe, send a photo or short video showing where the water is coming from.", verification: ["insurance", "business_check"], matchingWeights: urgent }),
      service("general-plumbing", "General plumbing repairs", ["general plumber", "tap repair", "toilet repair", "shower repair", "outside tap", "water pressure"], [...locationWhen, "description", "property_type"], ["plumbing"], { verification: ["insurance"] }),
      service("drain-clearance", "Blocked drains & drain clearance", ["blocked sink", "blocked toilet", "blocked drain", "drain clearance", "drain inspection"], [...locationWhen, "blockage_location", "property_type", "active_overflow"], ["drainage"], { verification: ["insurance"], matchingWeights: urgent }),
      service("boiler-repair", "Boiler breakdown, repair & service", ["boiler breakdown", "boiler repair", "boiler service", "no hot water", "no heating", "boiler stopped"], [...locationWhen, "boiler_make_model", "error_code", "heating_status", "hot_water_status"], ["boilers", "heating"], { verification: ["regulated_heating_credential", "insurance"], matchingWeights: specialist }),
      service("boiler-replacement", "Boiler replacement", ["new boiler", "replace boiler", "boiler replacement"], [...locationWhen, "boiler_type", "property_type", "bedrooms", "bathrooms"], ["boilers", "heating"], { verification: ["regulated_heating_credential", "insurance"], matchingWeights: specialist }),
      service("heating-radiators", "Heating, radiators & thermostats", ["heating fault", "radiator repair", "radiator replacement", "thermostat", "underfloor heating"], [...locationWhen, "system_type", "fault_or_scope"], ["heating", "radiator_work", "underfloor_heating"], { verification: ["insurance"] }),
      service("hot-water-cylinder", "Hot-water cylinder", ["hot water cylinder", "unvented cylinder", "cylinder repair"], [...locationWhen, "cylinder_type", "fault_or_scope"], ["heating", "hot_water_cylinder"], { verification: ["relevant_cylinder_credential", "insurance"], matchingWeights: specialist }),
      service("commercial-plumbing-heating", "Commercial plumbing & heating", ["commercial plumbing", "commercial heating", "commercial boiler"], [...locationWhen, "site_type", "scope", "access"], ["commercial", "plumbing", "heating"], { verification: ["business_check", "insurance", "regulated_heating_credential"], matchingWeights: specialist }),
      service("hvac-air-conditioning", "Air conditioning & HVAC", ["hvac", "air conditioning repair", "commercial air con"], [...locationWhen, "system_make_model", "fault_or_scope", "site_type"], ["HVAC", "commercial"], { verification: ["relevant_refrigerant_credential", "insurance"], matchingWeights: specialist }),
    ],
  },
  {
    slug: "cleaning-clearance-property-care",
    name: "Cleaning, Clearance & Property Care",
    buyerTypes: ["CONSUMER", "TRADE", "BUSINESS"],
    hyperlocal: true,
    services: [
      service("domestic-cleaning", "Domestic & regular cleaning", ["house cleaning", "domestic cleaner", "regular cleaner", "home cleaning"], [...locationWhen, "property_type", "bedrooms", "bathrooms", "recurrence"], ["domestic_cleaning", "recurring_services"]),
      service("deep-end-tenancy-cleaning", "Deep, move & end-of-tenancy cleaning", ["deep clean", "end of tenancy", "move in cleaning", "move out cleaning"], [...locationWhen, "property_type", "bedrooms", "bathrooms"], ["end_of_tenancy", "domestic_cleaning"], { photoPrompt: "Photos of the rooms help cleaners judge the time and equipment needed." }),
      service("commercial-airbnb-cleaning", "Office, commercial & short-let cleaning", ["office cleaning", "commercial cleaning", "airbnb cleaning", "short let cleaning"], [...locationWhen, "site_type", "floor_area", "recurrence", "access"], ["commercial_cleaning", "Airbnb_cleaning", "recurring_services"]),
      service("specialist-cleaning", "Carpet, upholstery, oven & window cleaning", ["carpet cleaning", "upholstery cleaning", "oven cleaning", "window cleaning"], [...locationWhen, "service_requested", "quantity_or_area"], ["carpet_cleaning", "oven_cleaning", "window_cleaning"]),
      service("exterior-cleaning", "Gutter, pressure, driveway & patio cleaning", ["gutter cleaning", "pressure washing", "driveway cleaning", "patio cleaning"], [...locationWhen, "area_or_length", "access", "photos"], ["pressure_washing", "window_cleaning"], { photoPrompt: "Please send photos showing the full area and access." }),
      service("after-build-cleaning", "After-build cleaning", ["after build cleaning", "builders clean", "post construction cleaning"], [...locationWhen, "site_type", "floor_area", "completion_stage"], ["after_build", "commercial_cleaning"]),
      service("property-clearance", "House, garage, loft, garden & office clearance", ["house clearance", "garage clearance", "loft clearance", "garden clearance", "office clearance", "rubbish clearance", "waste collection"], [...locationWhen, "waste_type", "waste_volume", "photos", "access"], ["clearance", "waste_removal"], { photoPrompt: "Please send wide photos of everything to be cleared, including any stairs or narrow access.", verification: ["waste_carrier_evidence", "insurance"], matchingWeights: specialist }),
    ],
  },
  {
    slug: "garden-outdoor-services",
    name: "Garden & Outdoor Services",
    buyerTypes: ["CONSUMER", "TRADE", "BUSINESS"],
    hyperlocal: true,
    services: [
      service("garden-maintenance", "Garden maintenance, lawns & hedges", ["gardener", "garden maintenance", "lawn mowing", "hedge cutting", "garden tidy", "regular gardener"], [...locationWhen, "garden_size", "recurrence", "waste_removal", "access"], ["garden_maintenance", "lawn_care", "hedge_work", "recurring_capacity"], { photoPrompt: "Please send a few photos showing the garden and access." }),
      service("garden-clearance", "Garden clearance", ["clear garden", "garden clearance", "overgrown garden"], [...locationWhen, "garden_size", "photos", "waste_removal", "access"], ["clearance", "waste_removal", "machinery"], { photoPrompt: "Please send wide photos of the garden and the route to the road.", verification: ["waste_carrier_evidence"] }),
      service("trees-stumps", "Tree work & stump grinding", ["tree pruning", "tree removal", "stump grinding", "cut tree"], [...locationWhen, "tree_count", "approximate_height", "photos", "access"], ["trees", "stump_grinding", "machinery"], { verification: ["specialist_tree_evidence", "insurance"], matchingWeights: specialist }),
      service("fencing-decking", "Fencing & decking", ["fence repair", "new fence", "fencing", "decking"], [...locationWhen, "dimensions", "materials_by", "photos", "access"], ["fencing", "decking"], { photoPrompt: "Please send photos and the approximate length or dimensions." }),
      service("patios-landscaping", "Patios, landscaping & groundworks", ["patio installation", "patio repair", "landscaping", "small groundworks", "garden drainage"], [...locationWhen, "dimensions", "scope", "materials_by", "photos", "access"], ["patios", "landscaping", "machinery"], { matchingWeights: specialist }),
      service("turf-artificial-grass", "Turf & artificial grass", ["new turf", "artificial grass", "lay turf"], [...locationWhen, "area", "ground_condition", "materials_by", "photos"], ["turf", "artificial_grass"]),
      service("garden-structures", "Sheds, raised beds & garden structures", ["shed assembly", "shed removal", "raised beds", "garden structure"], [...locationWhen, "dimensions", "scope", "materials_by", "access"], ["garden_structures", "waste_removal"]),
    ],
  },
  {
    slug: "appliance-repair-home-equipment",
    name: "Appliance Repair & Home Equipment",
    buyerTypes: ["CONSUMER", "BUSINESS"],
    hyperlocal: true,
    services: [
      service("washing-laundry-appliance-repair", "Washing machine & tumble dryer repair", ["washing machine", "tumble dryer", "washer dryer", "not draining", "e18"], [...locationWhen, "appliance_type", "manufacturer", "model", "error_code", "fault", "integrated"], ["washing_machines", "tumble_dryers", "diagnostics"], { photoPrompt: "Please send a photo of the appliance and, if practical, its model/rating plate.", matchingWeights: specialist }),
      service("dishwasher-repair", "Dishwasher repair", ["dishwasher", "dishwasher repair", "dishwasher leaking", "dishwasher error"], [...locationWhen, "manufacturer", "model", "error_code", "fault", "integrated", "leaking"], ["dishwashers", "diagnostics"], { matchingWeights: specialist }),
      service("refrigeration-appliance-repair", "Fridge & freezer repair", ["fridge repair", "freezer repair", "fridge freezer", "fridge not cold"], [...locationWhen, "appliance_type", "manufacturer", "model", "fault", "has_power"], ["fridges", "freezers", "diagnostics"], { matchingWeights: specialist }),
      service("cooking-appliance-repair", "Oven, cooker, hob & extractor repair", ["oven repair", "cooker repair", "hob repair", "extractor repair", "microwave repair", "range cooker"], [...locationWhen, "appliance_type", "manufacturer", "model", "error_code", "fault", "fuel_type"], ["ovens", "cookers", "hobs", "diagnostics"], { verification: ["relevant_gas_or_electrical_evidence"], matchingWeights: specialist }),
      service("commercial-appliance-repair", "Commercial appliance repair", ["commercial appliance", "commercial dishwasher", "commercial oven"], [...locationWhen, "appliance_type", "manufacturer", "model", "fault", "site_type"], ["commercial", "diagnostics"], { verification: ["business_check", "insurance"], matchingWeights: specialist }),
      service("appliance-installation", "Appliance installation & disconnection", ["install appliance", "disconnect appliance", "fit washing machine", "fit dishwasher", "appliance installation"], [...locationWhen, "appliance_type", "integrated", "existing_connections"], ["installation", "integrated"], { verification: ["relevant_gas_or_electrical_evidence"] }),
    ],
  },
  {
    slug: "locksmith-security-access",
    name: "Locksmith, Security & Access",
    buyerTypes: ["CONSUMER", "TRADE", "BUSINESS"],
    hyperlocal: true,
    services: [
      service("emergency-locksmith", "Emergency locksmith & lockout", ["locked out", "emergency locksmith", "lost keys", "broken key", "can't get in", "cant get in"], ["postcode", "property_type", "authority_to_access", "door_type", "urgency", "phone_availability"], ["emergency_locksmith", "residential_locks", "commercial_locks", "24_hour"], { verification: ["identity_business_check", "insurance", "verified_business_address", "admin_approval"], matchingWeights: urgent }),
      service("lock-repair-replacement", "Lock repair & replacement", ["lock replacement", "lock repair", "door won't lock", "window lock", "garage lock"], [...locationWhen, "door_or_window_type", "lock_type", "authority_to_access"], ["residential_locks", "commercial_locks"], { verification: ["identity_business_check", "insurance", "verified_business_address", "admin_approval"], matchingWeights: specialist }),
      service("upvc-multipoint-locks", "uPVC & multipoint lock repair", ["upvc door lock", "multipoint lock", "upvc won't lock", "upvc wont lock"], [...locationWhen, "door_type", "symptoms", "authority_to_access"], ["UPVC_multipoint"], { verification: ["identity_business_check", "insurance", "admin_approval"], matchingWeights: specialist }),
      service("smart-locks-entry-access", "Smart locks, door entry & access control", ["smart lock", "door entry", "access control", "keypad entry"], [...locationWhen, "property_type", "doors_or_zones", "existing_system", "installation_or_repair"], ["smart_locks", "access_control"], { verification: ["identity_business_check", "insurance", "admin_approval"], matchingWeights: specialist }),
      service("cctv-alarms-intercom", "CCTV, alarms & intercoms", ["cctv", "security camera", "alarm system", "intercom"], [...locationWhen, "property_type", "cameras_doors_zones", "existing_system", "network_available", "installation_or_repair"], ["CCTV", "alarms", "intercom"], { verification: ["identity_business_check", "insurance", "verified_business_address", "admin_approval"], matchingWeights: specialist }),
      service("security-upgrades", "Security upgrades", ["security upgrade", "improve door security", "secure my property"], [...locationWhen, "property_type", "scope", "authority_to_access"], ["residential_locks", "commercial_locks", "smart_locks"], { verification: ["identity_business_check", "insurance", "admin_approval"], matchingWeights: specialist }),
    ],
  },
] as const;

const industriesBySlug = new Map(HYPERLOCAL_INDUSTRIES.map((industry) => [industry.slug, industry]));
const servicesBySlug = new Map(HYPERLOCAL_INDUSTRIES.flatMap((industry) => industry.services.map((entry) => [entry.slug, { industry, service: entry }] as const)));

export function hyperlocalIndustry(slug: string | null | undefined) {
  return slug ? industriesBySlug.get(slug) ?? null : null;
}

export function hyperlocalService(slug: string | null | undefined) {
  return slug ? servicesBySlug.get(slug) ?? null : null;
}

export function hyperlocalIndustryForService(slug: string | null | undefined) {
  return hyperlocalService(slug)?.industry ?? null;
}

export function hyperlocalRecognitionRules() {
  return HYPERLOCAL_INDUSTRIES.flatMap((industry) => industry.services.flatMap((entry) => (
    entry.aliases.map((alias) => ({ industrySlug: industry.slug, serviceSlug: entry.slug, label: entry.name, alias }))
  )));
}

export function inferUrgency(text: string, requiredBy: Date | null, now = new Date()): RequestUrgency {
  if (/\b(?:locked out|burst pipe|flooding|active leak|breakdown|stranded|emergency|right now|immediately)\b/i.test(text)) return "EMERGENCY";
  if (/\b(?:within (?:two|2) hours?|next (?:two|2) hours?)\b/i.test(text)) return "WITHIN_2_HOURS";
  if (/\b(?:today|same day|this evening|tonight)\b/i.test(text)) return "SAME_DAY";
  if (/\b(?:tomorrow|next day)\b/i.test(text)) return "NEXT_DAY";
  if (/\b(?:this week|by friday|before the weekend|at the weekend|this weekend)\b/i.test(text)) return "THIS_WEEK";
  if (requiredBy) {
    const hours = (requiredBy.getTime() - now.getTime()) / 3_600_000;
    if (hours <= 2) return "WITHIN_2_HOURS";
    if (hours <= 24) return "SAME_DAY";
    if (hours <= 48) return "NEXT_DAY";
    if (hours <= 168) return "THIS_WEEK";
    return "FUTURE_BOOKING";
  }
  return "FLEXIBLE";
}

export function recurrenceCadence(text: string) {
  if (/\bweekly\b/i.test(text)) return "WEEKLY" as const;
  if (/\b(?:fortnightly|every (?:two|2) weeks)\b/i.test(text)) return "FORTNIGHTLY" as const;
  if (/\bmonthly\b/i.test(text)) return "MONTHLY" as const;
  return "ONE_OFF" as const;
}
