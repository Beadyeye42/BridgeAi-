import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const categorySeed = readFileSync(
  new URL("../supabase/migrations/20260804205358_seed_initial_product_categories.sql", import.meta.url),
  "utf8",
);
const requiredModels = ["User", "SupplierCompany", "SupplierTeamMembership", "SupplierAccreditation", "CustomerContact", "Conversation", "WhatsAppMessage", "WhatsAppJob", "Attachment", "QuoteRequest", "SupplierOpportunity", "QuoteRequestItem", "SupplierAssignment", "SupplierQuotation", "CoverageArea", "ProductCategory", "Subscription", "Notification", "AuditLog"];

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
});
