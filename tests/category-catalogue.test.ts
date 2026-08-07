import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  categoryResponsibilityNotice,
  launchedIntakeCategoryWhere,
  launchedSupplierCategoryWhere,
  launchCategoryRootId,
  normalizeLaunchCategorySlug,
  plumbingHeatingRootSlug,
  unavailableCatalogueForConversation,
} from "../lib/categories/catalogue";

describe("launch product catalogue", () => {
  it("prevents a broad industry root from becoming a supplier-routable request", () => {
    const processor = readFileSync(join(process.cwd(), "lib/whatsapp/processor.ts"), "utf8");
    expect(processor).toContain("!category.parent?.active");
    expect(processor).toContain("Boolean(category?.parent)");
  });

  it("keeps one stable launch root", () => {
    expect(launchCategoryRootId).toBe("category_windows");
    expect(plumbingHeatingRootSlug).toBe("plumbing-heating-mechanical");
  });

  it.each([
    ["doors", "windows"],
    ["upvc-doors", "upvc-windows"],
    ["aluminium-doors", "aluminium-windows"],
    ["bifold-doors", "aluminium-windows"],
    ["timber-doors", "timber-windows"],
    ["conservatories-extensions", "conservatories"],
    ["roofing", "roof-lanterns"],
  ])("maps the legacy %s category to %s", (legacy, current) => {
    expect(normalizeLaunchCategorySlug(legacy)).toBe(current);
  });

  it("preserves current categories and empty drafts", () => {
    expect(normalizeLaunchCategorySlug("toughened-laminated-glass")).toBe("toughened-laminated-glass");
    expect(normalizeLaunchCategorySlug(null)).toBeNull();
  });

  it("requires both the product and its parent group to be active for supplier selection", () => {
    expect(launchedSupplierCategoryWhere()).toEqual({
      active: true,
      parentId: { not: null },
      parent: { is: { active: true } },
    });
    expect(launchedIntakeCategoryWhere()).toEqual({
      active: true,
      OR: [{ parentId: null }, { parent: { is: { active: true } } }],
    });
  });

  it("blocks staged catalogues until the required launch switch is active", () => {
    expect(unavailableCatalogueForConversation("I need two fabricated steel frames", ["windows"])?.code)
      .toBe("METAL_FABRICATION_NOT_LAUNCHED");
    expect(unavailableCatalogueForConversation("Can I quote a roller shutter?", ["windows"])?.code)
      .toBe("SPECIALIST_DOORS_NOT_LAUNCHED");
    expect(unavailableCatalogueForConversation(
      "I need an FD60 fire door",
      ["garage-industrial-specialist-doors", "garage-doors"],
    )?.code).toBe("FIRE_DOORS_NOT_LAUNCHED");
    expect(unavailableCatalogueForConversation(
      "I need a roller shutter",
      ["garage-industrial-specialist-doors", "garage-doors"],
    )?.code).toBe("PRODUCT_NOT_LAUNCHED");
  });

  it("allows launched catalogues and keeps technical responsibility explicit", () => {
    expect(unavailableCatalogueForConversation(
      "I need steel beams",
      ["bespoke-metal-fabrication", "steel-beams"],
    )).toBeNull();
    expect(categoryResponsibilityNotice("steel-beams", "bespoke-metal-fabrication"))
      .toContain("supplier remains responsible");
    expect(categoryResponsibilityNotice("fire-doors")).toContain("verified certification");
    expect(unavailableCatalogueForConversation(
      "I need an air source heat pump",
      ["plumbing-heating-mechanical", "heat-pumps"],
    )).toBeNull();
    expect(categoryResponsibilityNotice("heat-pumps", "plumbing-heating-mechanical"))
      .toContain("final equipment selection");
  });

  it("blocks PHE routing when its industry or requested product is offline", () => {
    expect(unavailableCatalogueForConversation("I need an air source heat pump", ["windows"])?.code)
      .toBe("PHE_NOT_LAUNCHED");
    expect(unavailableCatalogueForConversation(
      "I need an air source heat pump",
      ["plumbing-heating-mechanical", "boilers-heating-packages"],
    )?.code).toBe("PRODUCT_NOT_LAUNCHED");
  });
});
