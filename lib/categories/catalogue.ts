export const launchCategoryRootId = "category_windows";
export const metalFabricationRootSlug = "bespoke-metal-fabrication";
export const specialistDoorsRootSlug = "garage-industrial-specialist-doors";

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
  code: "FIRE_DOORS_NOT_LAUNCHED" | "METAL_FABRICATION_NOT_LAUNCHED" | "SPECIALIST_DOORS_NOT_LAUNCHED" | "PRODUCT_NOT_LAUNCHED";
  reply: string;
};

const fireDoorPattern = /\bfire[- ]?(?:rated[- ]?)?doors?(?:ets?)?\b/i;
const metalFabricationPattern = /\b(?:bespoke metal fabrication|metal fabrication|steel beams?|lintels?|fabricated (?:steel |metal )?frames?|balustrades?|metal gates?|railings?|metal balconies|metal staircases?|structural steel|aluminium pressings?|powder[- ]coated (?:steel |metal |aluminium )?components?)\b/i;
const specialistDoorPattern = /\b(?:garage doors?|roller shutters?|sectional doors?|communal entrance doors?|automatic doors?|steel security doors?|shopfronts?)\b/i;
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

export function unavailableCatalogueForConversation(
  messageText: string,
  availableSlugs: Iterable<string>,
): UnavailableCatalogue | null {
  const available = new Set(availableSlugs);
  if (fireDoorPattern.test(messageText) && !available.has("fire-doors")) {
    return {
      code: "FIRE_DOORS_NOT_LAUNCHED",
      reply: "Fire-door quoting is not open yet because the certification and product-data checks must be in place first. I don’t want to route safety-critical work through a general door category. Bridge AI will make this service available only when those controls are ready.",
    };
  }
  if (metalFabricationPattern.test(messageText) && !available.has(metalFabricationRootSlug)) {
    return {
      code: "METAL_FABRICATION_NOT_LAUNCHED",
      reply: "Bespoke metal-fabrication quotes are being prepared but are not open yet. I don’t want to send your drawing to unsuitable suppliers. Bridge AI will make this category available once the approved fabricator network is ready.",
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
  return null;
}

export function categoryResponsibilityNotice(slug: string, parentSlug?: string | null) {
  if (slug === metalFabricationRootSlug || parentSlug === metalFabricationRootSlug) {
    return "Bridge AI structures and routes the enquiry only. The appointed supplier remains responsible for final engineering checks, manufacturing drawings, tolerances, fixings, material suitability and statutory compliance before manufacture.";
  }
  if (slug === "fire-doors") {
    return "Fire-door work requires verified certification, declared product performance, compatible ironmongery and the correct installation context. The supplier remains responsible for confirming the compliant doorset and installation requirements.";
  }
  return null;
}
