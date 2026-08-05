import { describe, expect, it } from "vitest";
import {
  conversationProgress,
  quoteDraftFingerprint,
  repeatClarification,
  requiredQuestionKey,
} from "../lib/whatsapp/intake-state";

const completeDraft = {
  deliveryPostcode: "GL52 6TD",
  categorySlug: "windows",
  title: "Five windows",
  summary: "Supply five white uPVC windows",
  items: [{ description: "Window", quantity: 5 }],
};

describe("WhatsApp intake conversation state", () => {
  it("fingerprints equivalent objects independently of property order", () => {
    expect(quoteDraftFingerprint({ b: 2, a: 1 })).toBe(quoteDraftFingerprint({ a: 1, b: 2 }));
  });

  it("uses application-required fields even if the model proposes no question", () => {
    expect(requiredQuestionKey({ ...completeDraft, items: [] }, "NONE")).toBe("PRODUCT");
    expect(requiredQuestionKey({ ...completeDraft, deliveryPostcode: null }, "NONE")).toBe("DELIVERY_POSTCODE");
    expect(requiredQuestionKey(completeDraft, "NONE")).toBe("NONE");
  });

  it("escalates after two repeated turns with no draft progress", () => {
    const fingerprint = quoteDraftFingerprint(completeDraft);
    const first = conversationProgress({
      previousFingerprint: fingerprint,
      previousQuestionKey: "SPECIFICATION",
      previousUnproductiveTurns: 0,
      currentFingerprint: fingerprint,
      currentQuestionKey: "SPECIFICATION",
    });
    expect(first).toMatchObject({ progressed: false, repeatedQuestion: true, unproductiveTurns: 1, needsHumanReview: false });
    const second = conversationProgress({
      previousFingerprint: fingerprint,
      previousQuestionKey: "SPECIFICATION",
      previousUnproductiveTurns: first.unproductiveTurns,
      currentFingerprint: fingerprint,
      currentQuestionKey: "SPECIFICATION",
    });
    expect(second).toMatchObject({ unproductiveTurns: 2, needsHumanReview: true });
  });

  it("resets the loop counter as soon as the draft changes", () => {
    const progress = conversationProgress({
      previousFingerprint: quoteDraftFingerprint({ ...completeDraft, summary: "Old" }),
      previousQuestionKey: "SPECIFICATION",
      previousUnproductiveTurns: 1,
      currentFingerprint: quoteDraftFingerprint(completeDraft),
      currentQuestionKey: "SPECIFICATION",
    });
    expect(progress).toMatchObject({ progressed: true, unproductiveTurns: 0, needsHumanReview: false });
  });

  it("uses a fixed professional clarification for a repeated field", () => {
    expect(repeatClarification("DELIVERY_POSTCODE")).toContain("full UK delivery postcode");
    expect(repeatClarification("NONE")).toBeNull();
  });
});
