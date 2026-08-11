import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { categorySlugFromName } from "../lib/categories/slug";
import { industryExperience, industryLaunchBlocker } from "../lib/categories/industry-registry";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("simple industry administration", () => {
  it("shows only top-level industries on the main administrator page", () => {
    const page = read("app/admin/categories/page.tsx");
    expect(page).toContain("where: { parentId: null, adminVisible: true }");
    expect(page).toContain('title="Industries"');
    expect(page).toContain("Manage industry");
    expect(page).not.toContain("categories.map");
  });

  it("keeps product controls inside their own industry workspace", () => {
    const page = read("app/admin/categories/[id]/page.tsx");
    expect(page).toContain("where: { id, parentId: null, adminVisible: true }");
    expect(page).toContain("Manage only the products and matching catalogue for this industry");
    expect(page).toContain("ProductCreateForm");
  });

  it("retires legacy catalogue roots without deleting their records", () => {
    const migration = read("supabase/migrations/20260807144722_simplify_industry_admin_catalogue.sql");
    const schema = read("prisma/schema.prisma");
    expect(schema).toContain("adminVisible  Boolean");
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "adminVisible"');
    expect(migration).toContain("category_doors");
    expect(migration).toContain("SYSTEM.INDUSTRY_ADMIN_SIMPLIFIED");
    expect(migration).not.toContain("DELETE FROM");
  });

  it("creates safe slugs without asking an administrator for technical values", () => {
    expect(categorySlugFromName("Plumbing, Heating & Mechanical (PHE)")).toBe("plumbing-heating-and-mechanical-phe");
    expect(categorySlugFromName("Glass & Glazing")).toBe("glass-and-glazing");
    const actions = read("components/admin/admin-actions.tsx");
    const route = read("app/api/admin/categories/route.ts");
    expect(actions).not.toContain('name="slug"');
    expect(route).toContain("categorySlugFromName(parsed.data.name)");
    expect(route).toContain("active: false");
  });

  it("cannot launch an industry before its own experience and products are ready", () => {
    expect(industryLaunchBlocker("windows", 1)).toBeNull();
    expect(industryLaunchBlocker("windows", 0)).toContain("at least one product");
    expect(industryLaunchBlocker("future-industry", 3)).toContain("supplier screen");
    expect(industryExperience("plumbing-heating-mechanical").launchReady).toBe(true);
    expect(industryExperience("transport-delivery-removals").launchReady).toBe(true);
    expect(industryExperience("bespoke-metal-fabrication").launchReady).toBe(false);
    const route = read("app/api/admin/categories/[id]/route.ts");
    expect(route).toContain("industryLaunchBlocker");
  });
});
