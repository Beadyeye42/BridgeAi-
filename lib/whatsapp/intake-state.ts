import { createHash } from "node:crypto";

export const intakeQuestionKeys = [
  "INDUSTRY",
  "PRODUCT",
  "DELIVERY_POSTCODE",
  "CATEGORY",
  "COMPOSITE_STYLE",
  "ROOF_GLAZING_SPECIFICATION",
  "PHE_SPECIFICATION",
  "SPECIFICATION",
  "REQUIREMENTS",
  "NONE",
] as const;

export type IntakeQuestionKey = (typeof intakeQuestionKeys)[number];

export type TradeClarification = {
  materialNeeded: boolean;
  colourNeeded: boolean;
  colourTerm: string | null;
};

type TradeDraft = {
  categorySlug: string | null;
  title: string | null;
  summary: string | null;
  items: Array<{ description: string; specification?: string | null }>;
};

type IntakeConversationMessage = {
  direction: "INBOUND" | "OUTBOUND";
  text: string;
};

export const MAX_UNPRODUCTIVE_TURNS = 2;

const recognisedIndustryColourPattern = /\b(?:white|black|anthracite(?: gr[ae]y)?|anthercite(?: gr[ae]y)?|antracite(?: gr[ae]y)?|slate gr[ae]y|agate gr[ae]y|chartwell(?: green)?|cream|irish oak|rosewood(?: brown)?)\b/i;
const colourMentionPattern = /\b(?:white|black|anthracite(?: gr[ae]y)?|anthercite(?: gr[ae]y)?|antracite(?: gr[ae]y)?|slate gr[ae]y|agate gr[ae]y|chartwell(?: green)?|cream|irish oak|rosewood(?: brown)?|olive(?: green)?)\b/gi;

export function isRecognisedIndustryColour(value: string | null | undefined) {
  return Boolean(value && recognisedIndustryColourPattern.test(value));
}

export function compositeDoorStylePhotoPrompt() {
  return "To match the exact composite door and make supplier pricing easier, please send a photo or screenshot of the style you want. A brochure image is perfect. If you don’t have one, reply NO PHOTO and briefly describe the style instead.";
}

export function compositeDoorPhotoDecision(draft: TradeDraft, messages: IntakeConversationMessage[]) {
  const draftEvidence = [
    draft.categorySlug,
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
  ].filter((value): value is string => Boolean(value)).join(" ");
  const isCompositeDoor = /\bcomposite[-\s]+doors?\b/i.test(draftEvidence);
  const hasStyleFile = messages.some((message) => message.direction === "INBOUND"
    && /^\[Customer (?:attachment|uploaded)\b/i.test(message.text));
  const alreadyAsked = messages.some((message) => message.direction === "OUTBOUND"
    && message.text.includes("photo or screenshot of the style you want"));
  const customerHasNoPhoto = messages.some((message) => message.direction === "INBOUND"
    && /\b(?:no photo|no picture|no image|don['’]?t have (?:a )?(?:photo|picture|image)|do not have (?:a )?(?:photo|picture|image)|can['’]?t (?:send|provide) (?:a )?(?:photo|picture|image)|cannot (?:send|provide) (?:a )?(?:photo|picture|image))\b/i.test(message.text));
  const handled = hasStyleFile || alreadyAsked || customerHasNoPhoto;
  return { isCompositeDoor, hasStyleFile, alreadyAsked, customerHasNoPhoto, handled, shouldAsk: isCompositeDoor && !handled };
}

export type RoofGlazingSpecificationDecision = {
  isRoofGlazing: boolean;
  internalSizesNeeded: boolean;
  materialNeeded: boolean;
  colourNeeded: boolean;
  shouldAsk: boolean;
};

export function roofGlazingSpecificationPrompt(input: RoofGlazingSpecificationDecision) {
  const missing = [
    input.internalSizesNeeded ? "the INTERNAL opening size (width × length, preferably in mm)" : null,
    input.materialNeeded ? "the frame/material suppliers should price, such as aluminium, uPVC, timber or glass only" : null,
    input.colourNeeded ? "the colour or finish" : null,
  ].filter((value): value is string => Boolean(value));
  const fields = missing.length > 1
    ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`
    : missing[0];
  return `To help suppliers price the exact roof glazing, please provide ${fields}. Please label the measurements as INTERNAL so they are not confused with external sizes.`;
}

const pheCategorySlugs = new Set([
  "plumbing-heating-mechanical",
  "boilers-heating-packages",
  "heat-pumps",
  "cylinders-hot-water-storage",
  "underfloor-heating",
  "radiators-heat-emitters",
  "pipework-fittings",
  "valves-heating-controls",
  "pumps-pressurisation",
  "mechanical-plant-packages",
]);

const industryRootCategorySlugs = new Set([
  "windows",
  "plumbing-heating-mechanical",
  "bespoke-metal-fabrication",
  "garage-industrial-specialist-doors",
]);

const pheSpecificationEvidence: Record<string, RegExp> = {
  "boilers-heating-packages": /\b(?:gas|oil|electric|hybrid|combi|system|regular|heat only|\d+(?:\.\d+)?\s*kW|flue|boiler schedule)\b/i,
  "heat-pumps": /\b(?:air[- ]source|ground[- ]source|monobloc|split|hybrid|heat loss|\d+(?:\.\d+)?\s*kW|flow temperature|single[- ]phase|three[- ]phase)\b/i,
  "cylinders-hot-water-storage": /\b(?:vented|unvented|direct|indirect|twin[- ]coil|thermal store|buffer|\d+(?:\.\d+)?\s*(?:l|litres?))\b/i,
  "underfloor-heating": /\b(?:wet|electric|overlay|screed|low[- ]profile|\d+(?:\.\d+)?\s*m(?:2|²)|zones?|pipe centres?)\b/i,
  "radiators-heat-emitters": /\b(?:type\s*[123]|panel|designer|towel rail|trench|fan convector|\d+\s*(?:w|watts?|btu)|\d+\s*x\s*\d+\s*mm)\b/i,
  "pipework-fittings": /\b(?:copper|pex|mlcp|plastic|carbon steel|stainless|\d+(?:\.\d+)?\s*mm|\bDN\s*\d+|pipe schedule)\b/i,
  "valves-heating-controls": /\b(?:isolation|balancing|mixing|zone|trv|thermostat|actuator|\bDN\s*\d+|\d+(?:\.\d+)?\s*mm)\b/i,
  "pumps-pressurisation": /\b(?:flow|head|duty|circulator|booster|pressurisation|expansion vessel|condensate|m3\/h|m³\/h|l\/s|kpa|bar)\b/i,
  "mechanical-plant-packages": /\b(?:schematic|schedule|drawing|specification|boq|bill of quantities|plantroom|packaged|skid)\b/i,
};

export type PheSpecificationDecision = {
  isPhe: boolean;
  categorySlug: string | null;
  hasAttachment: boolean;
  hasPricingSpecification: boolean;
  alreadyAsked: boolean;
  shouldAsk: boolean;
};

export function pheSpecificationPrompt(categorySlug: string | null) {
  const prompts: Record<string, string> = {
    "boilers-heating-packages": "For an accurate plumbing, heating or mechanical quote, what boiler type or fuel, output (kW) and package items do you need? A schedule or specification is welcome.",
    "heat-pumps": "For an accurate plumbing, heating or mechanical quote, is this air-source, ground-source or hybrid, and what design heat loss or output (kW) is required? Please send the heat-loss calculation or schedule if you have it.",
    "cylinders-hot-water-storage": "For an accurate plumbing, heating or mechanical quote, what cylinder or vessel type, capacity in litres and coil arrangement do you need? A schedule is welcome.",
    "underfloor-heating": "For an accurate plumbing, heating or mechanical quote, what floor area, number of zones and floor build-up should suppliers price? You can send a drawing or schedule instead.",
    "radiators-heat-emitters": "For an accurate plumbing, heating or mechanical quote, please send the radiator or emitter sizes and outputs, or upload the schedule.",
    "pipework-fittings": "For an accurate plumbing, heating or mechanical quote, what pipe material or system, sizes and quantities do you need? A take-off or schedule is ideal.",
    "valves-heating-controls": "For an accurate plumbing, heating or mechanical quote, what valve or control types, sizes and quantities do you need? A schedule is welcome.",
    "pumps-pressurisation": "For an accurate plumbing, heating or mechanical quote, what pump or unit type and duty information (such as flow and head) should suppliers price? A schedule is welcome.",
    "mechanical-plant-packages": "For an accurate plumbing, heating or mechanical quote, please send the plant schedule, schematic or bill of quantities, or briefly list the main equipment required.",
  };
  return prompts[categorySlug ?? ""]
    ?? "For an accurate plumbing, heating or mechanical quote, which product or package do you need? A schedule, schematic, heat-loss calculation, drawing or PDF is welcome.";
}

export function pheSpecificationDecision(draft: TradeDraft, messages: IntakeConversationMessage[]): PheSpecificationDecision {
  const categorySlug = draft.categorySlug;
  const isPhe = Boolean(categorySlug && pheCategorySlugs.has(categorySlug));
  const evidence = [
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
    ...messages.filter((message) => message.direction === "INBOUND").map((message) => message.text),
  ].filter((value): value is string => Boolean(value)).join(" ");
  const hasAttachment = messages.some((message) => message.direction === "INBOUND" && /^\[Customer (?:attachment|uploaded)\b/i.test(message.text));
  const alreadyAsked = messages.some((message) => message.direction === "OUTBOUND" && message.text.includes("For an accurate plumbing, heating or mechanical quote"));
  const hasPricingSpecification = Boolean(categorySlug && pheSpecificationEvidence[categorySlug]?.test(evidence));
  return {
    isPhe,
    categorySlug,
    hasAttachment,
    hasPricingSpecification,
    alreadyAsked,
    shouldAsk: isPhe && !hasAttachment && !hasPricingSpecification && !alreadyAsked,
  };
}

export function roofGlazingSpecificationDecision(draft: TradeDraft, messages: IntakeConversationMessage[]): RoofGlazingSpecificationDecision {
  const inboundEvidence = messages
    .filter((message) => message.direction === "INBOUND")
    .map((message) => message.text);
  const evidence = [
    ...inboundEvidence,
    draft.categorySlug,
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
  ].filter((value): value is string => Boolean(value)).join(" ");
  const isRoofGlazing = /\b(?:roof[-\s]*glass|roof[-\s]*glazing|flat[-\s]*roof[-\s]*glass|roof[-\s]*lights?|rooflights?|roof[-\s]*lanterns?|stepped?[-\s]*(?:glass[-\s]*)?units?)\b/i.test(evidence);
  const dimensionPair = "\\d+(?:\\.\\d+)?\\s*(?:mm|cm|m)?\\s*(?:x|×|by)\\s*\\d+(?:\\.\\d+)?\\s*(?:mm|cm|m)?";
  const internalSizesKnown = new RegExp(`(?:internal|inside|structural[-\\s]*opening|kerb[-\\s]*opening|upstand[-\\s]*opening)(?:[-\\s]*(?:size|sizes|dimensions?))?[^\\n]{0,50}${dimensionPair}|${dimensionPair}[^\\n]{0,35}(?:internal|inside|structural[-\\s]*opening|kerb[-\\s]*opening|upstand[-\\s]*opening)`, "i").test(evidence);
  const materialKnown = /\b(?:uPVC|PVCu|aluminium|aluminum|timber|wood|frameless|glass[-\s]*only|no frame)\b/i.test(evidence);
  const latestColour = latestColourMention(evidence);
  const colourKnown = isRecognisedIndustryColour(latestColour)
    || /\b(?:RAL\s*[-:]?\s*\d{4}|BS\s*[-:]?\s*\d{3,4}|manufacturer(?:'s)?\s+(?:colour|finish|code|name)|no colour|colour not applicable|frameless|glass[-\s]*only|no frame)\b/i.test(evidence);
  const decision = {
    isRoofGlazing,
    internalSizesNeeded: isRoofGlazing && !internalSizesKnown,
    materialNeeded: isRoofGlazing && !materialKnown,
    colourNeeded: isRoofGlazing && !colourKnown,
    shouldAsk: false,
  };
  decision.shouldAsk = decision.internalSizesNeeded || decision.materialNeeded || decision.colourNeeded;
  return decision;
}

function latestColourMention(value: string) {
  return Array.from(value.matchAll(new RegExp(colourMentionPattern.source, "gi"))).at(-1)?.[0] ?? null;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function quoteDraftFingerprint(draft: unknown) {
  return createHash("sha256").update(canonicalJson(draft)).digest("hex");
}

export function conversationProgress(input: {
  previousFingerprint: string | null;
  previousQuestionKey: string | null;
  previousUnproductiveTurns: number;
  currentFingerprint: string;
  currentQuestionKey: IntakeQuestionKey;
}) {
  const progressed = input.previousFingerprint !== input.currentFingerprint;
  const repeatedQuestion = input.currentQuestionKey !== "NONE"
    && input.previousQuestionKey === input.currentQuestionKey;
  const unproductiveTurns = !progressed && repeatedQuestion
    ? Math.min(MAX_UNPRODUCTIVE_TURNS, input.previousUnproductiveTurns + 1)
    : 0;
  return {
    progressed,
    repeatedQuestion,
    unproductiveTurns,
    needsHumanReview: unproductiveTurns >= MAX_UNPRODUCTIVE_TURNS,
  };
}

export function requiredQuestionKey(
  draft: {
    deliveryPostcode: string | null;
    categorySlug: string | null;
    title: string | null;
    summary: string | null;
    items: unknown[];
  },
  proposed: IntakeQuestionKey,
  tradeClarification: TradeClarification = {
    materialNeeded: false,
    colourNeeded: false,
    colourTerm: null,
  },
): IntakeQuestionKey {
  if (!draft.categorySlug) return "INDUSTRY";
  if (industryRootCategorySlugs.has(draft.categorySlug)) return "PRODUCT";
  if (!draft.items.length) return "PRODUCT";
  if (!draft.deliveryPostcode) return "DELIVERY_POSTCODE";
  if (tradeClarification.materialNeeded || tradeClarification.colourNeeded) return "SPECIFICATION";
  if (!draft.title || !draft.summary) return "REQUIREMENTS";
  return proposed;
}

function safeClarificationTerm(value: string | null | undefined) {
  return value?.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || null;
}

export function enforceTradeClarification(
  draft: TradeDraft,
  proposed: TradeClarification,
  customerMessages: string[],
): TradeClarification {
  if (draft.categorySlug && pheCategorySlugs.has(draft.categorySlug)) {
    return { materialNeeded: false, colourNeeded: false, colourTerm: null };
  }
  const evidence = [
    ...customerMessages.slice(-12),
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
  ].filter((value): value is string => Boolean(value)).join(" ");
  const materialKnown = /\b(?:uPVC|PVCu|aluminium|aluminum|timber|wood|composite|frameless|glass[-\s]*only|no frame)\b/i.test(evidence);
  const broadMaterialCategory = draft.categorySlug === "windows" || draft.categorySlug === "doors";
  const oliveMentioned = /\bolive(?:\s+green)?\b/i.test(evidence);
  const industryColourResolved = /\b(?:RAL\s*[-:]?\s*\d{4}|BS\s*[-:]?\s*\d{3,4}|(?:closest|nearest)(?:\s+available)?(?:\s+olive)?\s+(?:match|finish|shade|colour)|manufacturer(?:'s)?\s+(?:colour|finish|code|name)|(?:colour|finish)\s+code)\b/i.test(evidence);
  const colourTerm = proposed.colourTerm ?? latestColourMention(evidence) ?? (oliveMentioned ? "olive" : null);
  const recognisedIndustryColour = isRecognisedIndustryColour(colourTerm);
  return {
    materialNeeded: materialKnown ? false : proposed.materialNeeded || broadMaterialCategory,
    colourNeeded: recognisedIndustryColour || industryColourResolved
      ? false
      : proposed.colourNeeded || (oliveMentioned && !industryColourResolved),
    colourTerm,
  };
}

export function tradeSpecificationClarification(input: TradeClarification, productDescription?: string | null) {
  const product = safeClarificationTerm(productDescription)?.toLowerCase() || "product";
  const colour = safeClarificationTerm(input.colourTerm);
  if (input.materialNeeded && input.colourNeeded) {
    return `For the ${product}, what material should suppliers price, and for “${colour ?? "that colour"}” do you have a RAL or manufacturer colour reference—or should they offer their closest available match?`;
  }
  if (input.materialNeeded) {
    return `What material should suppliers price for the ${product}—for example uPVC, aluminium or timber?`;
  }
  if (input.colourNeeded) {
    return `When you say “${colour ?? "that colour"}”, do you have a RAL or manufacturer colour reference—or should suppliers offer their closest available match?`;
  }
  return null;
}

export function industrySelectionPrompt(industryNames: string[] = [
  "Windows, doors and glazing",
  "Plumbing, heating and mechanical",
]) {
  const launched = [...new Set(industryNames.map((name) => name.trim()).filter(Boolean))];
  const choices = launched.length
    ? new Intl.ListFormat("en-GB", { style: "long", type: "disjunction" }).format(launched)
    : "the industry and product you need";
  return `Which industry is this quote for — ${choices}? You can include the product details now, or send a photo, drawing, schedule or PDF.`;
}

export function repeatClarification(questionKey: IntakeQuestionKey) {
  const prompts: Record<Exclude<IntakeQuestionKey, "NONE">, string> = {
    INDUSTRY: industrySelectionPrompt(),
    PRODUCT: "I want to match this to the right suppliers. What product do you need and roughly how many? A photo, drawing or PDF is welcome too.",
    DELIVERY_POSTCODE: "What is the full UK delivery postcode? For example, GL52 6TD.",
    CATEGORY: "Which product is this for — for example uPVC windows, aluminium bifolds, a composite door or a roof lantern?",
    COMPOSITE_STYLE: compositeDoorStylePhotoPrompt(),
    ROOF_GLAZING_SPECIFICATION: "What are the internal opening size, frame/material and colour or finish for the roof glazing? Please label the measurements as INTERNAL.",
    PHE_SPECIFICATION: pheSpecificationPrompt(null),
    SPECIFICATION: "What important detail should suppliers price — for example size, material, colour or opening style?",
    REQUIREMENTS: "What would you like the supplier to include in this quote?",
  };
  return questionKey === "NONE" ? null : prompts[questionKey];
}
