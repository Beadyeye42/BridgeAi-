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
): IntakeQuestionKey {
  if (!draft.items.length) return "PRODUCT";
  if (!draft.deliveryPostcode) return "DELIVERY_POSTCODE";
  if (!draft.categorySlug) return "CATEGORY";
  if (!draft.title || !draft.summary) return "REQUIREMENTS";
  return proposed;
}

export function repeatClarification(questionKey: IntakeQuestionKey) {
  const prompts: Record<Exclude<IntakeQuestionKey, "NONE">, string> = {
    PRODUCT: "I couldn’t safely identify the product and quantity. Please describe what you need and how many.",
    DELIVERY_POSTCODE: "I couldn’t match that to a complete UK postcode. Please send the full delivery postcode, for example GL52 6TD.",
    CATEGORY: "I couldn’t identify the product category. Please tell me what kind of product or material this is.",
    SPECIFICATION: "I couldn’t safely add that specification. Please give the missing size, material, colour or other important detail in one message.",
    REQUIREMENTS: "I couldn’t safely understand that requirement. Please describe exactly what should be supplied or done.",
  };
  return questionKey === "NONE" ? null : prompts[questionKey];
}
