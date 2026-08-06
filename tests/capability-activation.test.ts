import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("../components/dashboard/capability-manager.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/supplier/capabilities/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/dashboard/capabilities/page.tsx", import.meta.url), "utf8");
const rematcher = readFileSync(new URL("../lib/matching/rematch.ts", import.meta.url), "utf8");

describe("simple supplier product activation", () => {
  it("offers immediate activation while retaining advanced matching controls", () => {
    expect(component).toContain("Activate for quotes");
    expect(component).toContain("Re-check quotes");
    expect(component).toContain("Advanced matching details");
    expect(component).toContain('method: "PATCH"');
    expect(component).toContain("Save advanced details");
  });

  it("activates only selected company products and records the change", () => {
    expect(route).toContain("productCategory.findFirst");
    expect(route).toContain("launchedSupplierCategoryWhere()");
    expect(route).toContain("suppliers: { some: { supplierCompanyId: auth.companyId } }");
    expect(route).toContain('capacityStatus: "AVAILABLE"');
    expect(route).toContain('action: "SUPPLIER.CAPABILITY_ACTIVATED"');
    expect(route).toContain("Only an owner or manager can activate supplier products");
  });

  it("loads selected active categories without joining through RLS-hidden legacy categories", () => {
    expect(page).toContain("supplierProductCategory.findMany");
    expect(page).toContain("productCategory.findMany");
    expect(page).toContain("launchedSupplierCategoryWhere()");
    expect(page).not.toContain("include: { productCategory: true }");
  });

  it("re-checks still-open requests after quick activation and advanced saves", () => {
    expect(route.match(/rematchOpenRequestsForSupplier/g)?.length).toBe(3);
    expect(rematcher).toContain('status: { in: ["OPEN", "MATCHING"] }');
    expect(rematcher).toContain("responseDueAt: { gt: now }");
    expect(rematcher).toContain("evaluateSupplierMatches(tx, quote");
    expect(rematcher).toContain("Math.min(quote.distributionLimit, MAX_AUTOMATIC_SUPPLIERS)");
    expect(rematcher).toContain("WHATSAPP.REQUEST_ASSIGNED_AFTER_CAPABILITY_UPDATE");
  });
});
