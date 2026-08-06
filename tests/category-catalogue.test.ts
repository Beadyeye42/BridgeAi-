import { describe, expect, it } from "vitest";
import { launchCategoryRootId, normalizeLaunchCategorySlug } from "../lib/categories/catalogue";

describe("launch product catalogue", () => {
  it("keeps one stable launch root", () => {
    expect(launchCategoryRootId).toBe("category_windows");
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
});
