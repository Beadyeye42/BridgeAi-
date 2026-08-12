import { describe, expect, it } from "vitest";
import { HYPERLOCAL_INDUSTRIES } from "@/lib/categories/hyperlocal-industries";
import { quoteQuestionGuidance, quoteQuestionWhatsAppHelp } from "@/lib/whatsapp/industry-question-guidance";

describe("industry-relevant WhatsApp quote questions", () => {
  it("uses glazing questions for a composite-door quote", () => {
    const message = quoteQuestionWhatsAppHelp({ categorySlug: "composite-doors", parentSlug: "windows" });
    expect(message).toContain("door style, glazing and final specification");
    expect(message).toContain("ASK B does your price include the requested door style, glazing and hardware?");
    expect(message).not.toContain("loading help");
  });

  it("uses technical package questions for heat pumps", () => {
    const guidance = quoteQuestionGuidance({ categorySlug: "heat-pumps", parentSlug: "plumbing-heating-mechanical" });
    expect(guidance.oneSupplierQuestion).toContain("equipment, controls and ancillaries");
    expect(guidance.allSuppliersQuestion).toContain("design information");
    expect(guidance.oneSupplierQuestion).not.toContain("glazing");
  });

  it("uses route and handling questions for transport", () => {
    const message = quoteQuestionWhatsAppHelp({ categorySlug: "furniture-small-removals", parentSlug: "transport-delivery-removals" }, "A");
    expect(message).toContain("ASK A does your price include loading help, stairs and unloading?");
    expect(message).toContain("collection time and delivery date");
  });

  it("has dedicated guidance for every launched hyperlocal industry", () => {
    for (const industry of HYPERLOCAL_INDUSTRIES) {
      const categorySlug = industry.services[0]!.slug;
      const guidance = quoteQuestionGuidance({ categorySlug, parentSlug: industry.slug });
      expect(guidance, industry.slug).not.toEqual(quoteQuestionGuidance({ categorySlug: "unknown", parentSlug: "unknown" }));
      expect(guidance.oneSupplierQuestion.endsWith("?"), industry.slug).toBe(true);
      expect(guidance.allSuppliersQuestion.endsWith("?"), industry.slug).toBe(true);
    }
  });

  it("keeps the universal ASK syntax explicit", () => {
    const message = quoteQuestionWhatsAppHelp({ categorySlug: "unknown", parentSlug: "unknown" });
    expect(message).toContain("ASK B ");
    expect(message).toContain("ASK ALL ");
  });
});
