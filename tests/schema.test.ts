import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const requiredModels = ["User", "SupplierCompany", "SupplierTeamMembership", "CustomerContact", "Conversation", "WhatsAppMessage", "Attachment", "QuoteRequest", "QuoteRequestItem", "SupplierAssignment", "SupplierQuotation", "CoverageArea", "ProductCategory", "Subscription", "Notification", "AuditLog"];

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
});
