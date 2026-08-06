import { createHash } from "node:crypto";

export const intakeQuestionKeys = [
  "PRODUCT",
  "DELIVERY_POSTCODE",
  "CATEGORY",
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

export const MAX_UNPRODUCTIVE_TURNS = 2;

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
    SPECIFICATION: "What important detail should suppliers price — for example size, material, colour or opening style?",
    REQUIREMENTS: "What would you like the supplier to include in this quote?",
  };
  return questionKey === "NONE" ? null : prompts[questionKey];
}
