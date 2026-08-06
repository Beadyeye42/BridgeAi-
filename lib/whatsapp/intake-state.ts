import { createHash } from "node:crypto";

export const intakeQuestionKeys = [
  "PRODUCT",
  "DELIVERY_POSTCODE",
  "CATEGORY",
  "COMPOSITE_STYLE",
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
  if (!draft.items.length) return "PRODUCT";
  if (!draft.deliveryPostcode) return "DELIVERY_POSTCODE";
  if (!draft.categorySlug) return "CATEGORY";
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
  const evidence = [
    ...customerMessages.slice(-12),
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
  ].filter((value): value is string => Boolean(value)).join(" ");
  const materialKnown = /\b(?:uPVC|PVCu|aluminium|aluminum|timber|wood|composite)\b/i.test(evidence);
  const broadMaterialCategory = draft.categorySlug === "windows" || draft.categorySlug === "doors";
  const oliveMentioned = /\bolive(?:\s+green)?\b/i.test(evidence);
  const industryColourResolved = /\b(?:RAL\s*[-:]?\s*\d{4}|BS\s*[-:]?\s*\d{3,4}|(?:closest|nearest)(?:\s+available)?(?:\s+olive)?\s+(?:match|finish|shade|colour)|manufacturer(?:'s)?\s+(?:colour|finish|code|name)|(?:colour|finish)\s+code)\b/i.test(evidence);
  const colourTerm = proposed.colourTerm ?? latestColourMention(evidence) ?? (oliveMentioned ? "olive" : null);
  const recognisedIndustryColour = isRecognisedIndustryColour(colourTerm);
  return {
    materialNeeded: proposed.materialNeeded || (broadMaterialCategory && !materialKnown),
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

export function repeatClarification(questionKey: IntakeQuestionKey) {
  const prompts: Record<Exclude<IntakeQuestionKey, "NONE">, string> = {
    PRODUCT: "I want to match this to the right suppliers. What product do you need and roughly how many? A photo, drawing or PDF is welcome too.",
    DELIVERY_POSTCODE: "What is the full UK delivery postcode? For example, GL52 6TD.",
    CATEGORY: "Which product is this for — for example uPVC windows, aluminium bifolds, a composite door or a roof lantern?",
    COMPOSITE_STYLE: compositeDoorStylePhotoPrompt(),
    SPECIFICATION: "What important detail should suppliers price — for example size, material, colour or opening style?",
    REQUIREMENTS: "What would you like the supplier to include in this quote?",
  };
  return questionKey === "NONE" ? null : prompts[questionKey];
}
