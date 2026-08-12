export type ProductKnowledgeCategory = {
  slug: string;
  name: string;
  description: string | null;
  parent?: { slug: string } | null;
};

export type ProductRecognition = {
  categorySlug: string;
  categoryName: string;
  description: string | null;
  answer: string;
  parentSlug: string | null;
};

type ProductRule = {
  slug: string;
  pattern: RegExp;
  answer?: string;
};

function literalPattern(value: string) {
  return new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i");
}

const productRules: ProductRule[] = [
  ...hyperlocalRecognitionRules().map(({ serviceSlug, label, alias }) => ({
    slug: serviceSlug,
    pattern: literalPattern(alias),
    answer: `Bridge AI can match ${label.toLocaleLowerCase("en-GB")} with suitable approved local businesses. Send what you need, the postcode and when you need it; a photo is welcome where useful.`,
  })),
  {
    slug: "man-with-a-van",
    pattern: /\b(?:man (?:with|and) a van|van and driver|van with (?:a )?driver|small van move)\b/i,
    answer: "A man-with-a-van quote normally needs the collection and delivery postcodes, preferred date and time, a list or photo of what is moving, and any stairs, parking, loading help or access restrictions.",
  },
  {
    slug: "trade-collection-delivery",
    pattern: /\b(?:trade|merchant|site) collection(?:s)?(?: and deliver(?:y|ies))?|collect (?:my |some )?(?:materials?|order) from (?:a )?(?:merchant|supplier)\b/i,
    answer: "For a trade collection, Bridge AI needs the collection and delivery postcodes, merchant or site collection details, item sizes or weight, ready time, delivery deadline and any loading restrictions.",
  },
  {
    slug: "same-day-courier",
    pattern: /\b(?:same[-\s]*day|urgent|express) courier(?:s)?\b/i,
    answer: "For a same-day courier quote, send the collection and delivery postcodes, when the item is ready, the delivery deadline, and the parcel count, dimensions and approximate weight.",
  },
  {
    slug: "furniture-small-removals",
    pattern: /\b(?:furniture|small|house|office) removal(?:s)?\b|\bhouse move\b|\b(?:move|collect|deliver|transport)\b[^.!?\n]{0,60}\b(?:sofa|settee|furniture|bed|wardrobe|table|chairs?|dresser|cabinet)\b|\b(?:sofa|settee|furniture|bed|wardrobe|table|chairs?|dresser|cabinet)\b[^.!?\n]{0,60}\b(?:move|collect|deliver|transport)\b/i,
  },
  { slug: "bulky-item-transport", pattern: /\b(?:bulky|large|heavy|awkward)[-\s]*item(?:s)? (?:transport|delivery|collection)\b/i },
  { slug: "building-material-deliveries", pattern: /\b(?:building|trade) material(?:s)? deliver(?:y|ies)\b/i },
  { slug: "multi-drop-delivery", pattern: /\bmulti[-\s]*drop deliver(?:y|ies)\b/i },
  {
    slug: "patio-sliding-doors",
    pattern: /\b(?:french\s*d+o+r+s?|frenchdoors?|patio\s*(?:sliding\s*)?d+o+r+s?|sliding\s*patio\s*d+o+r+s?|patio\s*sliders?|lift[-\s]*and[-\s]*slide|inline\s*sliders?)\b/i,
    answer: "French doors are a hinged pair that open from the centre, while patio sliders move horizontally and do not need swing space. Bridge AI can source either. Suppliers will normally need the overall frame size, material, colour, opening layout, threshold or glazing requirements, delivery postcode and required date.",
  },
  { slug: "composite-doors", pattern: /\bcomposite\s*d+o+r+s?\b/i },
  { slug: "aluminium-windows", pattern: /\b(?:aluminium|aluminum)\s+(?:windows?|d+o+r+s?|bi[-\s]*folds?)\b|\bbi[-\s]*fold\s*d+o+r+s?\b/i },
  { slug: "upvc-windows", pattern: /\b(?:u\s*pvc|pvc[-\s]*u|upvc)\s+(?:windows?|d+o+r+s?|frames?)\b/i },
  { slug: "timber-windows", pattern: /\b(?:timber|wooden?)\s+(?:windows?|d+o+r+s?|frames?)\b/i },
  { slug: "vertical-sliders", pattern: /\b(?:vertical\s*sliders?|sliding\s*sash\s*windows?|sash\s*windows?)\b/i },
  { slug: "conservatories", pattern: /\bconservator(?:y|ies)\b/i },
  { slug: "roof-lanterns", pattern: /\broof\s*lanterns?\b/i },
  { slug: "roof-glass", pattern: /\b(?:roof\s*lights?|rooflights?|flat[-\s]*roof\s*glass|stepped?\s*(?:glass\s*)?units?)\b/i },
  { slug: "toughened-laminated-glass", pattern: /\b(?:toughened|tempered|laminated?|laminate|safety)\s*(?:glass|units?|panes?)\b/i },
  { slug: "glass-units", pattern: /\b(?:sealed\s*units?|insulated\s*glass\s*units?|double[-\s]*glazed\s*units?|triple[-\s]*glazed\s*units?|IGUs?)\b/i },
  { slug: "mirrors-splashbacks", pattern: /\b(?:mirrors?|glass\s*splashbacks?|splashbacks?)\b/i },
  { slug: "replacement-mismeasured-units", pattern: /\b(?:replacement|miss[-\s]*measured|mismeasured)\s+(?:windows?|d+o+r+s?|frames?|units?|glass)\b/i },
  { slug: "juliet-balconies", pattern: /\b(?:juliet|juliette)\s+balcon(?:y|ies)\b/i },
  { slug: "boilers-heating-packages", pattern: /\b(?:boilers?|heating\s*packages?)\b/i },
  { slug: "heat-pumps", pattern: /\b(?:air[-\s]*source|ground[-\s]*source|hybrid)?\s*heat\s*pumps?\b/i },
  { slug: "cylinders-hot-water-storage", pattern: /\b(?:hot[-\s]*water\s*cylinders?|unvented\s*cylinders?|thermal\s*stores?|buffer\s*vessels?)\b/i },
  { slug: "underfloor-heating", pattern: /\bunder[-\s]*floor\s*heating\b/i },
  { slug: "radiators-heat-emitters", pattern: /\b(?:radiators?|heat\s*emitters?|towel\s*rails?|fan\s*convectors?)\b/i },
  { slug: "pipework-fittings", pattern: /\b(?:pipework|pipe\s*fittings?|copper\s*fittings?|pex|mlcp)\b/i },
  { slug: "valves-heating-controls", pattern: /\b(?:heating\s*controls?|thermostats?|actuators?|trvs?|valves?)\b/i },
  { slug: "pumps-pressurisation", pattern: /\b(?:circulator\s*pumps?|booster\s*sets?|pressurisation\s*units?|expansion\s*vessels?|condensate\s*pumps?)\b/i },
  { slug: "mechanical-plant-packages", pattern: /\b(?:mechanical\s*plant|plantroom\s*packages?|packaged\s*heating\s*systems?)\b/i },
  { slug: "steel-beams", pattern: /\bsteel\s*beams?\b/i },
  { slug: "lintels", pattern: /\blintels?\b/i },
  { slug: "fabricated-frames", pattern: /\bfabricated\s+(?:steel\s+|metal\s+)?frames?\b/i },
  { slug: "balustrades", pattern: /\bbalustrades?\b/i },
  { slug: "gates", pattern: /\bmetal\s*gates?\b/i },
  { slug: "railings", pattern: /\brailings?\b/i },
  { slug: "balconies", pattern: /\bmetal\s*balcon(?:y|ies)\b/i },
  { slug: "staircases", pattern: /\bmetal\s*staircases?\b/i },
  { slug: "structural-steel", pattern: /\bstructural\s*steel\b/i },
  { slug: "aluminium-pressings", pattern: /\b(?:aluminium|aluminum)\s*pressings?\b/i },
  { slug: "powder-coated-components", pattern: /\bpowder[-\s]*coated\s+(?:steel\s+|metal\s+|aluminium\s+|aluminum\s+)?components?\b/i },
  { slug: "garage-doors", pattern: /\bgarage\s*d+o+r+s?\b/i },
  { slug: "roller-shutters", pattern: /\broller\s*shutters?\b/i },
  { slug: "sectional-doors", pattern: /\bsectional\s*d+o+r+s?\b/i },
  { slug: "communal-entrance-doors", pattern: /\bcommunal\s*entrance\s*d+o+r+s?\b/i },
  { slug: "automatic-doors", pattern: /\bautomatic\s*d+o+r+s?\b/i },
  { slug: "steel-security-doors", pattern: /\bsteel\s*security\s*d+o+r+s?\b/i },
  { slug: "shopfronts", pattern: /\bshop\s*fronts?\b/i },
  { slug: "fire-doors", pattern: /\bfire[-\s]*(?:rated[-\s]*)?d+o+r+s?(?:ets?)?\b/i },
  {
    slug: "transport-delivery-removals",
    pattern: /^(?:transport|delivery|deliveries|removal|removals|moving|courier|man and van|man with a van)$/i,
    answer: "Yes — Bridge AI can help with transport, delivery and removals. Tell me what needs moving and the collection and delivery postcodes; a photo is welcome when it helps show the load.",
  },
  {
    slug: "plumbing-heating-mechanical",
    pattern: /^(?:plumbing|heating|mechanical|plumbing and heating)$/i,
  },
  {
    slug: "bespoke-metal-fabrication",
    pattern: /^(?:metal fabrication|steel fabrication|fabrication)$/i,
  },
  {
    slug: "garage-industrial-specialist-doors",
    pattern: /^(?:industrial doors|specialist doors|garage and industrial doors)$/i,
  },
];

function normaliseWords(value: string) {
  return value
    .toLocaleLowerCase("en-GB")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dynamicCategoryMatch(text: string, categories: ProductKnowledgeCategory[]) {
  const normalisedText = ` ${normaliseWords(text)} `;
  return categories
    .filter((category) => category.parent)
    .sort((left, right) => right.name.length - left.name.length)
    .find((category) => {
      const normalisedName = normaliseWords(category.name);
      return normalisedName.length >= 4 && normalisedText.includes(` ${normalisedName} `);
    });
}

export function recogniseCatalogueProduct(
  text: string,
  categories: ProductKnowledgeCategory[],
): ProductRecognition | null {
  const available = new Map(categories.map((category) => [category.slug, category]));
  const rule = productRules.find((candidate) => available.has(candidate.slug) && candidate.pattern.test(text));
  const category = rule ? available.get(rule.slug) : dynamicCategoryMatch(text, categories);
  if (!category) return null;
  const description = category.description?.trim() || null;
  return {
    categorySlug: category.slug,
    categoryName: category.name,
    description,
    answer: rule?.answer
      ?? `Bridge AI covers ${category.name.toLocaleLowerCase("en-GB")} through suitable approved suppliers.${description ? ` ${description}` : ""}`,
    parentSlug: category.parent?.slug ?? null,
  };
}

export function productMessageIntent(text: string): "QUOTE_REQUEST" | "QUESTION" {
  const trimmed = text.trim();
  if (/\b(?:difference|compare|explain|tell me about)\b/i.test(trimmed)) {
    return "QUESTION";
  }
  if (/\b(?:i\s+(?:need|want|would\s+like)|looking\s+for|quote|quotation|price|find\s+me|supply\s+me|can\s+i\s+(?:get|have|order)|(?:can|could|would)\s+you\s+(?:quote|source|find|supply)|can\s+someone\s+(?:move|collect|deliver|transport))\b/i.test(trimmed)) {
    return "QUOTE_REQUEST";
  }
  if (/\b(?:what|which|why|how)\b/i.test(trimmed)
      || /^(?:do|does|can|could|would|is|are)\b/i.test(trimmed)) {
    return "QUESTION";
  }
  return "QUOTE_REQUEST";
}

export function isClearCataloguePivot(input: {
  text: string;
  recognition: ProductRecognition;
  currentCategorySlug: string;
  currentIndustrySlug: string;
  expectedQuestionKey: string | null;
}) {
  if (productMessageIntent(input.text) === "QUESTION") return false;
  const recognisedIndustry = input.recognition.parentSlug ?? input.recognition.categorySlug;
  if (recognisedIndustry !== input.currentIndustrySlug) return true;
  if (input.recognition.categorySlug === input.currentCategorySlug) return false;
  if (input.expectedQuestionKey && input.expectedQuestionKey !== "PRODUCT") return false;
  return input.text.trim().split(/\s+/).length <= 8;
}

export function productRecoveryReply(recognition: ProductRecognition, text: string) {
  if (productMessageIntent(text) === "QUESTION") return recognition.answer;
  if (recognition.parentSlug === "transport-delivery-removals") {
    return "Yes — I can help. Please send a photo or short description of what is moving, plus the full collection and delivery postcodes.";
  }
  const localService = hyperlocalService(recognition.categorySlug);
  if (localService) {
    return `Yes — I can help with ${recognition.categoryName.toLocaleLowerCase("en-GB")}. What is the postcode and when do you need it? ${localService.service.photoPrompt ?? "You can send a photo or document if it helps explain the job."}`;
  }
  return `Yes — I can help you source ${recognition.categoryName.toLocaleLowerCase("en-GB")} from suitable approved suppliers. Roughly how many do you need? You can also send a photo, drawing or PDF.`;
}
import { hyperlocalRecognitionRules, hyperlocalService } from "@/lib/categories/hyperlocal-industries";
