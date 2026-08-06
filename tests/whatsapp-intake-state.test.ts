import { describe, expect, it } from "vitest";
import {
  compositeDoorPhotoDecision,
  compositeDoorStylePhotoPrompt,
  conversationProgress,
  enforceTradeClarification,
  isRecognisedIndustryColour,
  quoteDraftFingerprint,
  repeatClarification,
  requiredQuestionKey,
  tradeSpecificationClarification,
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

  it("does not allow unresolved trade material or colour to reach confirmation", () => {
    const clarification = { materialNeeded: true, colourNeeded: true, colourTerm: "olive" };
    expect(requiredQuestionKey({ ...completeDraft, deliveryPostcode: null }, "NONE", clarification)).toBe("DELIVERY_POSTCODE");
    expect(requiredQuestionKey(completeDraft, "NONE", clarification)).toBe("SPECIFICATION");
  });

  it("deterministically catches olive windows even if the model misses the ambiguity", () => {
    const clarification = enforceTradeClarification(
      { ...completeDraft, summary: "Supply six olive windows" },
      { materialNeeded: false, colourNeeded: false, colourTerm: null },
      ["I want 6 olive windows"],
    );
    expect(clarification).toEqual({ materialNeeded: true, colourNeeded: true, colourTerm: "olive" });
  });

  it("accepts an explicit material and industry colour resolution", () => {
    const clarification = enforceTradeClarification(
      { ...completeDraft, categorySlug: "upvc-windows", summary: "Supply six olive uPVC windows" },
      { materialNeeded: false, colourNeeded: true, colourTerm: "olive" },
      ["Six olive windows", "uPVC, RAL 6003"],
    );
    expect(clarification).toEqual({ materialNeeded: false, colourNeeded: false, colourTerm: "olive" });
  });

  it.each([
    "white",
    "black",
    "anthracite grey",
    "anthracite",
    "anthercite grey",
    "slate grey",
    "agate grey",
    "Chartwell green",
    "cream",
    "Irish oak",
    "rosewood brown",
  ])("accepts the recognised industry finish %s without asking for a RAL code", (colour) => {
    expect(isRecognisedIndustryColour(colour)).toBe(true);
    const clarification = enforceTradeClarification(
      {
        ...completeDraft,
        categorySlug: "upvc-windows",
        summary: `Supply six uPVC windows in ${colour}`,
      },
      { materialNeeded: false, colourNeeded: true, colourTerm: colour },
      [`Six uPVC windows in ${colour}`],
    );
    expect(clarification).toEqual({ materialNeeded: false, colourNeeded: false, colourTerm: colour });
  });

  it("still requires clarification for an unrecognised colour name", () => {
    const clarification = enforceTradeClarification(
      { ...completeDraft, categorySlug: "upvc-windows", summary: "Supply six uPVC windows in moss green" },
      { materialNeeded: false, colourNeeded: true, colourTerm: "moss green" },
      ["Six uPVC windows in moss green"],
    );
    expect(clarification.colourNeeded).toBe(true);
  });

  it("asks once for a composite-door style image before finalising the enquiry", () => {
    const decision = compositeDoorPhotoDecision({
      ...completeDraft,
      categorySlug: "composite-doors",
      title: "Composite front door",
      summary: "Supply one black composite front door",
      items: [{ description: "Composite front door" }],
    }, []);
    expect(decision).toMatchObject({ isCompositeDoor: true, handled: false, shouldAsk: true });
    expect(compositeDoorStylePhotoPrompt()).toContain("photo or screenshot");
    expect(compositeDoorStylePhotoPrompt()).toContain("NO PHOTO");
  });

  it("does not ask for a composite-door image when the customer already uploaded one", () => {
    const decision = compositeDoorPhotoDecision({
      ...completeDraft,
      categorySlug: "composite-doors",
      title: "Composite front door",
      summary: "Supply one black composite front door",
      items: [{ description: "Composite front door" }],
    }, [{ direction: "INBOUND", text: "[Customer attachment \"door.jpg\": black cottage-style composite door]" }]);
    expect(decision).toMatchObject({ hasStyleFile: true, handled: true, shouldAsk: false });
  });

  it("does not repeat the composite-door photo request or block a customer with no image", () => {
    const draft = {
      ...completeDraft,
      categorySlug: "composite-doors",
      title: "Composite front door",
      summary: "Supply one black composite front door",
      items: [{ description: "Composite front door" }],
    };
    expect(compositeDoorPhotoDecision(draft, [
      { direction: "OUTBOUND", text: compositeDoorStylePhotoPrompt() },
      { direction: "INBOUND", text: "Traditional style please" },
    ])).toMatchObject({ alreadyAsked: true, shouldAsk: false });
    expect(compositeDoorPhotoDecision(draft, [
      { direction: "INBOUND", text: "I don't have a photo, but it is a cottage style" },
    ])).toMatchObject({ customerHasNoPhoto: true, shouldAsk: false });
  });

  it("asks one compact material and industry-colour clarification", () => {
    const reply = tradeSpecificationClarification(
      { materialNeeded: true, colourNeeded: true, colourTerm: "olive" },
      "Windows",
    );
    expect(reply).toContain("what material");
    expect(reply).toContain("olive");
    expect(reply).toContain("RAL or manufacturer colour reference");
    expect(reply).toContain("closest available match");
    expect(reply?.match(/\?/g)).toHaveLength(1);
  });

  it("sanitises customer colour wording before using it in a reply", () => {
    const reply = tradeSpecificationClarification(
      { materialNeeded: false, colourNeeded: true, colourTerm: `olive\n${"x".repeat(200)}` },
      null,
    );
    expect(reply).not.toContain("\n");
    expect(reply?.length).toBeLessThan(240);
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
