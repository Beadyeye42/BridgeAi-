import { describe, expect, it } from "vitest";
import {
  isClearCataloguePivot,
  productMessageIntent,
  productRecoveryReply,
  recogniseCatalogueProduct,
  type ProductKnowledgeCategory,
} from "../lib/whatsapp/product-knowledge";

const categories: ProductKnowledgeCategory[] = [
  { slug: "windows", name: "Windows, doors and glazing", description: "Launch catalogue", parent: null },
  { slug: "transport-delivery-removals", name: "Transport, delivery and removals", description: "Moving and delivery services", parent: null },
  { slug: "plumbing-heating-mechanical", name: "Plumbing, heating and mechanical", description: "PHE catalogue", parent: null },
  {
    slug: "patio-sliding-doors",
    name: "Patio and French doors",
    description: "Patio sliders, inline and lift-and-slide doors, plus French door sets in any material.",
    parent: { slug: "windows" },
  },
  {
    slug: "heat-pumps",
    name: "Heat pumps",
    description: "Air-source, ground-source and hybrid heat-pump equipment.",
    parent: { slug: "plumbing-heating-mechanical" },
  },
  {
    slug: "man-with-a-van",
    name: "Man with a van",
    description: "Flexible van-and-driver transport.",
    parent: { slug: "transport-delivery-removals" },
  },
  {
    slug: "same-day-courier",
    name: "Same-day courier",
    description: "Urgent direct courier work.",
    parent: { slug: "transport-delivery-removals" },
  },
  {
    slug: "furniture-small-removals",
    name: "Furniture and small removals",
    description: "Furniture moves, small house moves and bulky Marketplace collections.",
    parent: { slug: "transport-delivery-removals" },
  },
];

describe("WhatsApp product knowledge safety net", () => {
  it.each([
    "I need a frenchdoor",
    "Can I get French doors?",
    "looking for a patio slider door",
    "price for a sliding patio door",
    "do you cover lift-and-slide doors",
  ])("recognises French and patio-door wording: %s", (message) => {
    expect(recogniseCatalogueProduct(message, categories)?.categorySlug).toBe("patio-sliding-doors");
  });

  it("distinguishes a product question from a sourcing request", () => {
    expect(productMessageIntent("What is the difference between French doors and a patio slider?"))
      .toBe("QUESTION");
    expect(productMessageIntent("I need a French door"))
      .toBe("QUOTE_REQUEST");
    expect(productMessageIntent("Can I get French doors?"))
      .toBe("QUOTE_REQUEST");
    expect(productMessageIntent("Could you quote a patio slider?"))
      .toBe("QUOTE_REQUEST");
  });

  it("provides a useful answer when the AI provider is temporarily unavailable", () => {
    const recognition = recogniseCatalogueProduct(
      "What is the difference between French doors and a patio slider?",
      categories,
    );
    expect(recognition).not.toBeNull();
    const reply = productRecoveryReply(recognition!, "What is the difference between French doors and a patio slider?");
    expect(reply).toContain("hinged pair");
    expect(reply).toContain("move horizontally");
    expect(reply).toContain("overall frame size");
  });

  it("uses the live category descriptions for other launched products", () => {
    const recognition = recogniseCatalogueProduct("Do you cover air source heat pumps?", categories);
    expect(recognition?.categorySlug).toBe("heat-pumps");
    expect(productRecoveryReply(recognition!, "Do you cover air source heat pumps?"))
      .toContain("Air-source, ground-source and hybrid");
  });

  it("does not claim support for a category that is not launched", () => {
    expect(recogniseCatalogueProduct("I need a roller shutter", categories)).toBeNull();
  });

  it.each([
    "I need a man with a van",
    "Can you find a van and driver?",
    "I need a van with a driver",
  ])("recognises everyday man-with-a-van wording: %s", (message) => {
    expect(recogniseCatalogueProduct(message, categories)?.categorySlug).toBe("man-with-a-van");
  });

  it("recognises a natural sofa move without making the customer choose an industry", () => {
    const recognition = recogniseCatalogueProduct(
      "Can someone move this sofa from Cheltenham to Birmingham Saturday?",
      categories,
    );
    expect(recognition?.categorySlug).toBe("furniture-small-removals");
    const reply = productRecoveryReply(recognition!, "Can someone move this sofa from Cheltenham to Birmingham Saturday?");
    expect(reply).toContain("photo or short description");
    expect(reply).toContain("full collection and delivery postcodes");
    expect(reply).not.toContain("choose an industry");
  });

  it("asks for the two locations and load details during provider recovery", () => {
    const recognition = recogniseCatalogueProduct("I need a man and a van", categories);
    expect(recognition?.parentSlug).toBe("transport-delivery-removals");
    expect(productRecoveryReply(recognition!, "I need a man and a van"))
      .toContain("collection and delivery postcodes");
  });

  it("recognises a plain-language industry pivot and does not force it into an old draft", () => {
    const recognition = recogniseCatalogueProduct("Transport", categories);
    expect(recognition?.categorySlug).toBe("transport-delivery-removals");
    expect(isClearCataloguePivot({
      text: "Transport",
      recognition: recognition!,
      currentCategorySlug: "patio-sliding-doors",
      currentIndustrySlug: "windows",
      expectedQuestionKey: "REQUIRED_BY",
    })).toBe(true);
  });

  it("does not mistake a material answer inside the same job for a new request", () => {
    const recognition = recogniseCatalogueProduct("uPVC windows", [
      ...categories,
      { slug: "upvc-windows", name: "uPVC windows and doors", description: null, parent: { slug: "windows" } },
    ]);
    expect(isClearCataloguePivot({
      text: "uPVC windows",
      recognition: recognition!,
      currentCategorySlug: "patio-sliding-doors",
      currentIndustrySlug: "windows",
      expectedQuestionKey: "SPECIFICATION",
    })).toBe(false);
  });
});
