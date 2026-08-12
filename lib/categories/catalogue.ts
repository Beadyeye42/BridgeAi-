export const launchCategoryRootId = "category_windows";
export const metalFabricationRootSlug = "bespoke-metal-fabrication";
export const specialistDoorsRootSlug = "garage-industrial-specialist-doors";
export const plumbingHeatingRootSlug = "plumbing-heating-mechanical";
export const transportDeliveryRootSlug = "transport-delivery-removals";

export function launchedSupplierCategoryWhere() {
  return {
    active: true,
    parentId: { not: null },
    parent: { is: { active: true } },
  } as const;
}

export function launchedIntakeCategoryWhere() {
  return {
    active: true,
    OR: [
      { parentId: null },
      { parent: { is: { active: true } } },
    ],
  };
}

const legacyCategoryAliases: Record<string, string> = {
  doors: "windows",
  "upvc-doors": "upvc-windows",
  "aluminium-doors": "aluminium-windows",
  "bifold-doors": "aluminium-windows",
  "timber-doors": "timber-windows",
  "conservatories-extensions": "conservatories",
  roofing: "roof-lanterns",
};

export function normalizeLaunchCategorySlug(slug: string | null) {
  if (!slug) return null;
  return legacyCategoryAliases[slug] ?? slug;
}

type UnavailableCatalogue = {
  code: "FIRE_DOORS_NOT_LAUNCHED" | "METAL_FABRICATION_NOT_LAUNCHED" | "SPECIALIST_DOORS_NOT_LAUNCHED" | "PHE_NOT_LAUNCHED" | "TRANSPORT_NOT_LAUNCHED" | "PRODUCT_NOT_LAUNCHED";
  reply: string;
};

const fireDoorPattern = /\bfire[- ]?(?:rated[- ]?)?doors?(?:ets?)?\b/i;
const metalFabricationPattern = /\b(?:bespoke metal fabrication|metal fabrication|steel beams?|lintels?|fabricated (?:steel |metal )?frames?|balustrades?|metal gates?|railings?|metal balconies|metal staircases?|structural steel|aluminium pressings?|powder[- ]coated (?:steel |metal |aluminium )?components?)\b/i;
const specialistDoorPattern = /\b(?:garage doors?|roller shutters?|sectional doors?|communal entrance doors?|automatic doors?|steel security doors?|shopfronts?)\b/i;
const plumbingHeatingPattern = /\b(?:plumbing|heating|mechanical|boilers?|heat pumps?|air[- ]source heat pumps?|ground[- ]source heat pumps?|hot[- ]water cylinders?|unvented cylinders?|thermal stores?|buffer vessels?|underfloor heating|radiators?|heat emitters?|pipework|pipe fittings?|valves?|heating controls?|circulator pumps?|booster sets?|pressurisation units?|expansion vessels?|mechanical plant)\b/i;
const transportDeliveryPattern = /\b(?:man (?:with|and) a van|van and driver|trade collections?|same[- ]day couriers?|small removals?|house moves?|furniture removals?|bulky[- ]item transport|building[- ]material deliveries|multi[- ]drop deliveries)\b/i;
const metalProducts: Array<{ slug: string; label: string; pattern: RegExp }> = [
  { slug: "steel-beams", label: "Steel beams", pattern: /\bsteel beams?\b/i },
  { slug: "lintels", label: "Lintels", pattern: /\blintels?\b/i },
  { slug: "fabricated-frames", label: "Fabricated frames", pattern: /\bfabricated (?:steel |metal )?frames?\b/i },
  { slug: "balustrades", label: "Balustrades", pattern: /\bbalustrades?\b/i },
  { slug: "gates", label: "Metal gates", pattern: /\bmetal gates?\b/i },
  { slug: "railings", label: "Railings", pattern: /\brailings?\b/i },
  { slug: "balconies", label: "Metal balconies", pattern: /\bmetal balconies\b/i },
  { slug: "staircases", label: "Metal staircases", pattern: /\bmetal staircases?\b/i },
  { slug: "structural-steel", label: "Structural steel", pattern: /\bstructural steel\b/i },
  { slug: "aluminium-pressings", label: "Aluminium pressings", pattern: /\baluminium pressings?\b/i },
  { slug: "powder-coated-components", label: "Powder-coated components", pattern: /\bpowder[- ]coated (?:steel |metal |aluminium )?components?\b/i },
];
const specialistDoorProducts: Array<{ slug: string; label: string; pattern: RegExp }> = [
  { slug: "garage-doors", label: "Garage doors", pattern: /\bgarage doors?\b/i },
  { slug: "roller-shutters", label: "Roller shutters", pattern: /\broller shutters?\b/i },
  { slug: "sectional-doors", label: "Sectional doors", pattern: /\bsectional doors?\b/i },
  { slug: "communal-entrance-doors", label: "Communal entrance doors", pattern: /\bcommunal entrance doors?\b/i },
  { slug: "automatic-doors", label: "Automatic doors", pattern: /\bautomatic doors?\b/i },
  { slug: "steel-security-doors", label: "Steel security doors", pattern: /\bsteel security doors?\b/i },
  { slug: "shopfronts", label: "Shopfronts", pattern: /\bshopfronts?\b/i },
];
const plumbingHeatingProducts: Array<{ slug: string; label: string; pattern: RegExp }> = [
  { slug: "boilers-heating-packages", label: "Boilers and heating packages", pattern: /\b(?:boilers?|heating packages?)\b/i },
  { slug: "heat-pumps", label: "Heat pumps", pattern: /\b(?:air[- ]source|ground[- ]source|hybrid)?\s*heat pumps?\b/i },
  { slug: "cylinders-hot-water-storage", label: "Cylinders and hot-water storage", pattern: /\b(?:hot[- ]water cylinders?|unvented cylinders?|thermal stores?|buffer vessels?)\b/i },
  { slug: "underfloor-heating", label: "Underfloor heating", pattern: /\bunderfloor heating\b/i },
  { slug: "radiators-heat-emitters", label: "Radiators and heat emitters", pattern: /\b(?:radiators?|heat emitters?|towel rails?|fan convectors?)\b/i },
  { slug: "pipework-fittings", label: "Pipework and fittings", pattern: /\b(?:pipework|pipe fittings?|copper fittings?|pex|mlcp)\b/i },
  { slug: "valves-heating-controls", label: "Valves and heating controls", pattern: /\b(?:valves?|trvs?|thermostats?|heating controls?|actuators?)\b/i },
  { slug: "pumps-pressurisation", label: "Pumps and pressurisation", pattern: /\b(?:circulator pumps?|booster sets?|pressurisation units?|expansion vessels?|condensate pumps?)\b/i },
  { slug: "mechanical-plant-packages", label: "Mechanical plant and packaged systems", pattern: /\b(?:mechanical plant|packaged heating systems?|plantroom packages?)\b/i },
];
const transportDeliveryProducts: Array<{ slug: string; label: string; pattern: RegExp }> = [
  { slug: "man-with-a-van", label: "Man with a van", pattern: /\b(?:man (?:with|and) a van|van and driver)\b/i },
  { slug: "trade-collection-delivery", label: "Trade collections and deliveries", pattern: /\b(?:trade|merchant|site) collections?(?: and deliver(?:y|ies))?\b/i },
  { slug: "same-day-courier", label: "Same-day courier", pattern: /\b(?:same[- ]day|urgent) couriers?\b/i },
  { slug: "furniture-small-removals", label: "Furniture and small removals", pattern: /\b(?:furniture|small|house|office) removals?|\bhouse moves?\b/i },
  { slug: "bulky-item-transport", label: "Bulky-item transport", pattern: /\b(?:bulky|large|heavy|awkward)[- ]items? (?:transport|delivery|collection)\b/i },
  { slug: "building-material-deliveries", label: "Building-material deliveries", pattern: /\b(?:building|trade) materials? deliver(?:y|ies)\b/i },
  { slug: "multi-drop-delivery", label: "Multi-drop delivery", pattern: /\bmulti[- ]drop deliver(?:y|ies)\b/i },
];

export function unavailableCatalogueForConversation(
  messageText: string,
  availableSlugs: Iterable<string>,
): UnavailableCatalogue | null {
  const available = new Set(availableSlugs);
  if (fireDoorPattern.test(messageText) && !available.has("fire-doors")) {
    return {
      code: "FIRE_DOORS_NOT_LAUNCHED",
      reply: "Fire-door quoting is not open yet because the certification and product-data checks must be in place first. I don’t want to route safety-critical work through a general door category. Bridge-iT will make this service available only when those controls are ready.",
    };
  }
  if (metalFabricationPattern.test(messageText) && !available.has(metalFabricationRootSlug)) {
    return {
      code: "METAL_FABRICATION_NOT_LAUNCHED",
      reply: "Bespoke metal-fabrication quotes are being prepared but are not open yet. I don’t want to send your drawing to unsuitable suppliers. Bridge-iT will make this category available once the approved fabricator network is ready.",
    };
  }
  const unavailableMetalProduct = metalProducts.find((product) => product.pattern.test(messageText) && !available.has(product.slug));
  if (unavailableMetalProduct) {
    return {
      code: "PRODUCT_NOT_LAUNCHED",
      reply: `${unavailableMetalProduct.label} quoting is temporarily offline. I don’t want to route this enquiry to unsuitable suppliers while that product is paused.`,
    };
  }
  if (specialistDoorPattern.test(messageText) && !available.has(specialistDoorsRootSlug)) {
    return {
      code: "SPECIALIST_DOORS_NOT_LAUNCHED",
      reply: "Garage, industrial and specialist-door quotes are being prepared but are not open yet. I don’t want to match your enquiry until the right approved suppliers and specification checks are ready.",
    };
  }
  const unavailableDoorProduct = specialistDoorProducts.find((product) => product.pattern.test(messageText) && !available.has(product.slug));
  if (unavailableDoorProduct) {
    return {
      code: "PRODUCT_NOT_LAUNCHED",
      reply: `${unavailableDoorProduct.label} quoting is temporarily offline. I don’t want to route this enquiry to unsuitable suppliers while that product is paused.`,
    };
  }
  if (plumbingHeatingPattern.test(messageText) && !available.has(plumbingHeatingRootSlug)) {
    return {
      code: "PHE_NOT_LAUNCHED",
      reply: "Plumbing, heating and mechanical quotes are temporarily offline. I don’t want to route a technical enquiry until the appropriate approved supplier network is available.",
    };
  }
  const unavailablePlumbingHeatingProduct = plumbingHeatingProducts.find((product) => product.pattern.test(messageText) && !available.has(product.slug));
  if (unavailablePlumbingHeatingProduct) {
    return {
      code: "PRODUCT_NOT_LAUNCHED",
      reply: `${unavailablePlumbingHeatingProduct.label} quoting is temporarily offline. I don’t want to route this enquiry to unsuitable suppliers while that product is paused.`,
    };
  }
  if (transportDeliveryPattern.test(messageText) && !available.has(transportDeliveryRootSlug)) {
    return {
      code: "TRANSPORT_NOT_LAUNCHED",
      reply: "Transport, delivery and removals quoting is temporarily offline. I don’t want to promise a vehicle or collection until the approved operator network is available.",
    };
  }
  const unavailableTransportProduct = transportDeliveryProducts.find((product) => product.pattern.test(messageText) && !available.has(product.slug));
  if (unavailableTransportProduct) {
    return {
      code: "PRODUCT_NOT_LAUNCHED",
      reply: `${unavailableTransportProduct.label} quoting is temporarily offline. I don’t want to route this request to an unsuitable operator while that service is paused.`,
    };
  }
  return null;
}

export function categoryResponsibilityNotice(slug: string, parentSlug?: string | null) {
  if (slug === metalFabricationRootSlug || parentSlug === metalFabricationRootSlug) {
    return "Bridge-iT structures and routes the enquiry only. The appointed supplier remains responsible for final engineering checks, manufacturing drawings, tolerances, fixings, material suitability and statutory compliance before manufacture.";
  }
  if (slug === "fire-doors") {
    return "Fire-door work requires verified certification, declared product performance, compatible ironmongery and the correct installation context. The supplier remains responsible for confirming the compliant doorset and installation requirements.";
  }
  if (slug === plumbingHeatingRootSlug || parentSlug === plumbingHeatingRootSlug) {
    return "Bridge-iT structures and routes the enquiry only. The supplier or installer remains responsible for final equipment selection, sizing, compatibility, design, commissioning and compliance with applicable building, gas, electrical, water and heat-pump requirements.";
  }
  if (slug === transportDeliveryRootSlug || parentSlug === transportDeliveryRootSlug) {
    return "Bridge-iT structures and routes the request only. The appointed operator remains responsible for vehicle suitability, load security, access, lifting and handling, insurance, licences and lawful carriage. Regulated waste disposal is not included unless Bridge-iT launches a separately controlled service.";
  }
  return null;
}
