import { describe, expect, it } from "vitest";
import {
  productMessageIntent,
  productRecoveryReply,
  recogniseCatalogueProduct,
  type ProductKnowledgeCategory,
} from "../lib/whatsapp/product-knowledge";

const categories: ProductKnowledgeCategory[] = [
  { slug: "windows", name: "Windows, doors and glazing", description: "Launch catalogue", parent: null },
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
});
