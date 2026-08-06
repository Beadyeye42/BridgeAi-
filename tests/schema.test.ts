import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const categorySeed = readFileSync(
  new URL("../supabase/migrations/20260804205358_seed_initial_product_categories.sql", import.meta.url),
  "utf8",
);
const tradeCategoryExpansion = readFileSync(
  new URL("../supabase/migrations/20260805152503_expand_trade_product_categories.sql", import.meta.url),
  "utf8",
);
const launchCategoryCatalogue = readFileSync(
  new URL("../supabase/migrations/20260806160415_launch_windows_doors_glazing_catalogue.sql", import.meta.url),
  "utf8",
);
const requiredModels = ["User", "SupplierCompany", "SupplierTeamMembership", "SupplierAccreditation", "SupplierCapability", "CustomerContact", "Conversation", "WhatsAppMessage", "WhatsAppJob", "Attachment", "QuoteRequest", "SupplierMatchDecision", "SupplierOpportunity", "QuoteRequestItem", "SupplierAssignment", "SupplierQuotation", "CoverageArea", "ProductCategory", "Subscription", "Notification", "AuditLog"];

describe("Prisma domain contract", () => {
  it.each(requiredModels)("defines %s", (model) => expect(schema).toMatch(new RegExp(`model ${model} \\{`)));
  it("isolates application tables from existing Supabase public data", () => {
    expect(schema).toContain('schemas   = ["bridge_ai"]');
    expect((schema.match(/@@schema\("bridge_ai"\)/g) ?? []).length).toBeGreaterThanOrEqual(requiredModels.length);
  });
  it("uses Supabase Auth identities without custom credential tables", () => {
    expect(schema).toContain('@map("portal_profiles")');
    expect(schema).toContain("@id @db.Uuid");
    expect(schema).not.toContain("model AuthSession");
    expect(schema).not.toContain("model PasswordResetToken");
    expect(schema).not.toContain("passwordHash");
  });
  it("ships an idempotent audited starter category catalogue", () => {
    expect(categorySeed).toContain("ON CONFLICT (slug) DO UPDATE");
    expect(categorySeed).toContain("SYSTEM.PRODUCT_CATEGORIES_SEEDED");
    expect(categorySeed).toContain("other-building-products");
  });
  it("ships an audited specific trade catalogue for accurate supplier matching", () => {
    expect(tradeCategoryExpansion).toContain("ON CONFLICT (slug) DO UPDATE");
    expect(tradeCategoryExpansion).toContain("SYSTEM.PRODUCT_CATEGORIES_EXPANDED");
    expect(tradeCategoryExpansion).toContain("upvc-windows");
    expect(tradeCategoryExpansion).toContain("aluminium-windows");
    expect(tradeCategoryExpansion).toContain("bifold-doors");
    expect(tradeCategoryExpansion).toContain("composite-doors");
    expect(tradeCategoryExpansion).toContain("patio-sliding-doors");
    expect(tradeCategoryExpansion).toContain("roof-lanterns");
    expect(tradeCategoryExpansion).toContain("juliet-balconies");
  });
  it("ships the focused windows, doors and glazing launch catalogue", () => {
    expect(launchCategoryCatalogue).toContain("Windows, doors and glazing");
    expect(launchCategoryCatalogue).toContain("uPVC windows and doors");
    expect(launchCategoryCatalogue).toContain("Aluminium windows and bifolds");
    expect(launchCategoryCatalogue).toContain("vertical-sliders");
    expect(launchCategoryCatalogue).toContain("glass-units");
    expect(launchCategoryCatalogue).toContain("toughened-laminated-glass");
    expect(launchCategoryCatalogue).toContain("mirrors-splashbacks");
    expect(launchCategoryCatalogue).toContain("replacement-mismeasured-units");
    expect(launchCategoryCatalogue).toContain("SYSTEM.PRODUCT_CATALOGUE_LAUNCHED");
  });
});
