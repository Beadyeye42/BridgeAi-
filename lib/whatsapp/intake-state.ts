import { createHash } from "node:crypto";
import { hyperlocalService } from "@/lib/categories/hyperlocal-industries";

export const intakeQuestionKeys = [
  "BUYER_TYPE",
  "PRODUCT",
  "DELIVERY_POSTCODE",
  "REQUIRED_BY",
  "FULFILMENT",
  "CATEGORY",
  "COMPOSITE_STYLE",
  "ROOF_GLAZING_SPECIFICATION",
  "PHE_SPECIFICATION",
  "TRANSPORT_ROUTE_ITEM",
  "TRANSPORT_ACCESS",
  "TRANSPORT_HANDLING",
  "HYPERLOCAL_SERVICE",
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
  "transport-delivery-removals",
]);

const transportCategorySlugs = new Set([
  "transport-delivery-removals",
  "man-with-a-van",
  "trade-collection-delivery",
  "same-day-courier",
  "furniture-small-removals",
  "bulky-item-transport",
  "building-material-deliveries",
  "multi-drop-delivery",
]);

const ukPostcodePattern = /\b(?:GIR\s?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?\s?\d[ABD-HJLNP-UW-Z]{2})\b/gi;

export type TransportIntakeDecision = {
  isTransport: boolean;
  itemKnown: boolean;
  collectionPostcodeKnown: boolean;
  deliveryPostcodeKnown: boolean;
  accessKnown: boolean;
  handlingKnown: boolean;
  nextQuestionKey: "TRANSPORT_ROUTE_ITEM" | "TRANSPORT_ACCESS" | "TRANSPORT_HANDLING" | null;
  shouldAsk: boolean;
};

export type HyperlocalServiceIntakeDecision = {
  isHyperlocalService: boolean;
  serviceSlug: string | null;
  prompt: string | null;
  shouldAsk: boolean;
};

const genericHyperlocalFields = new Set([
  "postcode",
  "current_location",
  "collection_postcode",
  "delivery_postcode",
  "required_date",
  "urgency",
  "preferred_time",
  "photos",
]);

function humaniseField(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fieldIsKnown(field: string, evidence: string) {
  const patterns: Record<string, RegExp> = {
    vehicle_registration: /\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/i,
    make_model: /\b(?:make|model|ford|vauxhall|volkswagen|vw|audi|bmw|mercedes|toyota|nissan|kia|hyundai|renault|peugeot|citro[eë]n|skoda|seat)\b/i,
    driveable: /\b(?:driveable|drivable|not driveable|won['’]?t drive|cannot drive|can drive)\b/i,
    tyre_size: /\b\d{3}\/\d{2}\s?R\d{2}\b/i,
    authority_to_access: /\b(?:my home|my house|my property|owner|tenant|landlord|authori[sz]ed|permission)\b/i,
    property_type: /\b(?:house|flat|apartment|office|shop|warehouse|commercial|bungalow|detached|semi[- ]detached|terrace)\b/i,
    manufacturer: /\b(?:manufacturer|brand|bosch|beko|hotpoint|indesit|samsung|lg|aeg|miele|neff|siemens|whirlpool)\b/i,
    model: /\b(?:model|model number|rating plate)\b/i,
    error_code: /\b(?:error|code|[ef]\d{1,3})\b/i,
    recurrence: /\b(?:one[- ]off|weekly|fortnightly|monthly|regular)\b/i,
    quantity: /\b\d+\s*(?:items?|units?|tyres?|wheels?)\b/i,
    photos: /\[Customer (?:attachment|uploaded)\b/i,
  };
  const direct = patterns[field];
  if (direct?.test(evidence)) return true;
  return new RegExp(`\\b${field.replaceAll("_", "[ -]?")}\\b`, "i").test(evidence);
}

export function hyperlocalServiceIntakeDecision(
  draft: TradeDraft,
  messages: IntakeConversationMessage[],
): HyperlocalServiceIntakeDecision {
  const entry = hyperlocalService(draft.categorySlug);
  if (!entry) return { isHyperlocalService: false, serviceSlug: null, prompt: null, shouldAsk: false };

  const inbound = messages.filter((message) => message.direction === "INBOUND").map((message) => message.text).join("\n");
  const evidence = [
    inbound,
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
  ].filter((value): value is string => Boolean(value)).join("\n");
  const alreadyAsked = messages.some((message) => message.direction === "OUTBOUND"
    && message.text.includes("To help the right local specialist quote accurately"));
  if (alreadyAsked) {
    return { isHyperlocalService: true, serviceSlug: entry.service.slug, prompt: null, shouldAsk: false };
  }

  const missing = entry.service.requiredInformation
    .filter((field) => !genericHyperlocalFields.has(field))
    .filter((field) => !fieldIsKnown(field, evidence))
    .slice(0, 2);
  const hasAttachment = /\[Customer (?:attachment|uploaded)\b/i.test(inbound);
  const detailRequest = missing.length
    ? `Please tell me ${missing.map((field) => humaniseField(field).toLocaleLowerCase("en-GB")).join(" and ")}.`
    : null;
  const photoRequest = !hasAttachment && entry.service.photoPrompt ? entry.service.photoPrompt : null;
  const prompt = ["To help the right local specialist quote accurately:", detailRequest, photoRequest]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  return {
    isHyperlocalService: true,
    serviceSlug: entry.service.slug,
    prompt: detailRequest || photoRequest ? prompt : null,
    shouldAsk: Boolean(detailRequest || photoRequest),
  };
}

function hasAnswerAfterPrompt(messages: IntakeConversationMessage[], promptPattern: RegExp) {
  const promptIndex = messages.findLastIndex((message) => (
    message.direction === "OUTBOUND" && promptPattern.test(message.text)
  ));
  return promptIndex >= 0 && messages.slice(promptIndex + 1).some((message) => (
    message.direction === "INBOUND" && message.text.trim().length > 0
  ));
}

export function transportIntakeDecision(
  draft: TradeDraft & { deliveryPostcode?: string | null },
  messages: IntakeConversationMessage[],
): TransportIntakeDecision {
  const isTransport = Boolean(draft.categorySlug && transportCategorySlugs.has(draft.categorySlug));
  if (!isTransport) {
    return {
      isTransport: false,
      itemKnown: false,
      collectionPostcodeKnown: false,
      deliveryPostcodeKnown: false,
      accessKnown: false,
      handlingKnown: false,
      nextQuestionKey: null,
      shouldAsk: false,
    };
  }
  const inbound = messages
    .filter((message) => message.direction === "INBOUND")
    .map((message) => message.text)
    .join("\n");
  const evidence = [
    inbound,
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
  ].filter((value): value is string => Boolean(value)).join("\n");
  const postcodes = new Set(Array.from(evidence.matchAll(ukPostcodePattern), (match) => match[0].replace(/\s+/g, "").toUpperCase()));
  const itemKnown = draft.items.length > 0
    && draft.items.some((item) => item.description.trim().length > 1);
  const collectionPostcodeKnown = postcodes.size >= 2
    || /\b(?:collection|collect(?:ion)?\s+from|pick[- ]?up)\b[^\n]{0,80}\b(?:GIR\s?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?\s?\d[ABD-HJLNP-UW-Z]{2})\b/i.test(evidence);
  const deliveryPostcodeKnown = Boolean(draft.deliveryPostcode) || postcodes.size >= 2;
  const accessKnown = /\b(?:ground[- ]?floor|first[- ]?floor|second[- ]?floor|upper[- ]?floor|stairs?|steps?|lift|elevator|level access|no stairs|access at both|access restrictions?)\b/i.test(inbound)
    || hasAnswerAfterPrompt(messages, /ground floor at both addresses|stairs or a lift at either end/i);
  const handlingKnown = /\b(?:driver (?:to )?help|help (?:to )?(?:carry|load|unload)|carry(?:ing)? help|loading help|unloading help|load it|unload it|two[- ]person|two man|extra crew|additional crew|someone (?:will )?help|help at both ends|no help (?:needed|required))\b/i.test(inbound)
    || hasAnswerAfterPrompt(messages, /driver to help carry or load|someone help at both ends/i);
  const nextQuestionKey = !itemKnown || !collectionPostcodeKnown || !deliveryPostcodeKnown
    ? "TRANSPORT_ROUTE_ITEM"
    : !accessKnown
      ? "TRANSPORT_ACCESS"
      : !handlingKnown
        ? "TRANSPORT_HANDLING"
        : null;
  return {
    isTransport,
    itemKnown,
    collectionPostcodeKnown,
    deliveryPostcodeKnown,
    accessKnown,
    handlingKnown,
    nextQuestionKey,
    shouldAsk: nextQuestionKey !== null,
  };
}

export function transportIntakePrompt(input: TransportIntakeDecision) {
  if (input.nextQuestionKey === "TRANSPORT_ROUTE_ITEM") {
    if (input.itemKnown) {
      return "Please send the full collection and delivery postcodes. A photo of the item is helpful too, especially for furniture or anything bulky.";
    }
    return "Please send a photo or short description of what is moving, plus the full collection and delivery postcodes.";
  }
  if (input.nextQuestionKey === "TRANSPORT_ACCESS") {
    return "Is it ground floor at both addresses, or are there stairs or a lift at either end?";
  }
  if (input.nextQuestionKey === "TRANSPORT_HANDLING") {
    return "Will you need the driver to help carry or load it, or will someone help at both ends?";
  }
  return null;
}

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
    buyerType?: "CONSUMER" | "TRADE" | "BUSINESS" | null;
    deliveryPostcode: string | null;
    categorySlug: string | null;
    title: string | null;
    summary: string | null;
    requiredBy: string | null;
    fulfilmentMode: "SERVICE" | "INSTALLATION" | "SUPPLY_ONLY" | "DELIVERY" | "COLLECTION" | null;
    items: unknown[];
  },
  proposed: IntakeQuestionKey,
  tradeClarification: TradeClarification = {
    materialNeeded: false,
    colourNeeded: false,
    colourTerm: null,
  },
): IntakeQuestionKey {
  if (!draft.categorySlug) return "PRODUCT";
  if (industryRootCategorySlugs.has(draft.categorySlug)) return "PRODUCT";
  if (!draft.items.length) return "PRODUCT";
  if (!draft.deliveryPostcode) return "DELIVERY_POSTCODE";
  if (!draft.requiredBy) return "REQUIRED_BY";
  if (!draft.fulfilmentMode) return "FULFILMENT";
  if (draft.buyerType === null) return "BUYER_TYPE";
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
  if (draft.categorySlug && (pheCategorySlugs.has(draft.categorySlug) || transportCategorySlugs.has(draft.categorySlug) || hyperlocalService(draft.categorySlug))) {
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

export function universalRequestPrompt() {
  return [
    "What do you need? Bridge it.",
    "Send me a message, photo, drawing or document. Tell me where you need it and when you need it.",
    "If you know the quantity, specification and whether you need delivery, collection or on-site work, include those too.",
  ].join("\n\n");
}

export function productSelectionPrompt() {
  return [
    "What exactly do you need, and roughly how many?",
    "Describe it in your own words or send a clear photo, survey, drawing, schedule or PDF. I’ll identify the right specialist suppliers behind the scenes.",
  ].join("\n\n");
}

export function repeatClarification(questionKey: IntakeQuestionKey) {
  const prompts: Record<Exclude<IntakeQuestionKey, "NONE">, string> = {
    BUYER_TYPE: "Is this for you personally, for your trade work or client, or for another business? Reply PERSONAL, TRADE or BUSINESS.",
    PRODUCT: productSelectionPrompt(),
    DELIVERY_POSTCODE: "What is the full UK delivery postcode? For example, GL52 6TD.",
    REQUIRED_BY: "When do you need it? Give me a date or a clear deadline, such as Friday or within seven days.",
    FULFILMENT: "How do you need it — delivery, collection, supply only, or work carried out on site?",
    CATEGORY: "Which product is this for — for example uPVC windows, aluminium bifolds, a composite door or a roof lantern?",
    COMPOSITE_STYLE: compositeDoorStylePhotoPrompt(),
    ROOF_GLAZING_SPECIFICATION: "What are the internal opening size, frame/material and colour or finish for the roof glazing? Please label the measurements as INTERNAL.",
    PHE_SPECIFICATION: pheSpecificationPrompt(null),
    TRANSPORT_ROUTE_ITEM: "Please send a photo or short description of what is moving, plus the full collection and delivery postcodes.",
    TRANSPORT_ACCESS: "Is it ground floor at both addresses, or are there stairs or a lift at either end?",
    TRANSPORT_HANDLING: "Will you need the driver to help carry or load it, or will someone help at both ends?",
    HYPERLOCAL_SERVICE: "Please answer the short service-specific question above so I can match the right local specialist.",
    SPECIFICATION: "What important detail should suppliers price — for example size, material, colour or opening style?",
    REQUIREMENTS: "What would you like the supplier to include in this quote?",
  };
  return questionKey === "NONE" ? null : prompts[questionKey];
}
