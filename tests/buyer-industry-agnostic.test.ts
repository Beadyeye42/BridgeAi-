import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buyerExperienceSchema, defaultBuyerExperience } from "@/lib/buyer/industry-experience";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (name.includes(" 2.")) return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("industry-agnostic Buyer Hub", () => {
  it("contains no windows, doors or glazing terminology in shared Buyer Hub source", () => {
    const source = sourceFiles(join(root, "app/buyer")).concat(sourceFiles(join(root, "components/buyer")), sourceFiles(join(root, "lib/buyer"))).map((path) => readFileSync(path, "utf8")).join("\n");
    expect(source).not.toMatch(/\b(?:uPVC|windows|glazing|French door|patio slider)\b/i);
  });

  it("uses a generic outcome state plus a configurable stage key", () => {
    const schema = read("prisma/schema.prisma");
    const migration = read("supabase/migrations/20260824184947_buyer_industry_agnostic_hub.sql");
    expect(schema).toContain("enum BuyerOrderState");
    expect(schema).toContain('stageKey          String');
    expect(schema).toContain("buyerExperienceConfig");
    expect(schema).not.toContain("enum BuyerOrderStatus");
    expect(migration).toContain("ProductCategory_buyerExperienceConfig_industry_only_check");
    expect(migration).toContain("BuyerOrder_stageKey_format_check");
  });

  it("validates labels, configurable fields and arbitrary lifecycle stages", () => {
    expect(buyerExperienceSchema.safeParse(defaultBuyerExperience).success).toBe(true);
    const custom = {
      ...defaultBuyerExperience,
      labels: { ...defaultBuyerExperience.labels, requestSingular: "movement", orderSingular: "booking" },
      detailFields: [{ key: "access", label: "Access", type: "text", source: "qualification" }],
      stages: [
        { key: "selected", label: "Carrier selected", state: "SELECTED", allowedNext: ["booked"] },
        { key: "booked", label: "Booked", state: "ACTIVE", allowedNext: ["complete"] },
        { key: "complete", label: "Delivered", state: "COMPLETED", allowedNext: [] },
      ],
    };
    expect(buyerExperienceSchema.safeParse(custom).success).toBe(true);
  });

  it("rejects lifecycle transitions to missing stages", () => {
    const broken = { ...defaultBuyerExperience, stages: [{ key: "selected", label: "Selected", state: "SELECTED", allowedNext: ["missing"] }, { key: "done", label: "Done", state: "COMPLETED", allowedNext: [] }] };
    expect(buyerExperienceSchema.safeParse(broken).success).toBe(false);
  });

  it("restricts configuration writes to administrators and records an audit entry", () => {
    const route = read("app/api/admin/categories/[id]/route.ts");
    expect(route).toContain("requireAdminApi");
    expect(route).toContain('if (buyerExperienceChanged && !isGroup)');
    expect(route).toContain("writeAuditLog");
    expect(route).toContain("ADMIN.INDUSTRY_BUYER_EXPERIENCE_UPDATED");
  });
});
