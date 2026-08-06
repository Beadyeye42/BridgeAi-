import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("../components/dashboard/capability-manager.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/supplier/capabilities/route.ts", import.meta.url), "utf8");

describe("simple supplier product activation", () => {
  it("offers immediate activation while retaining advanced matching controls", () => {
    expect(component).toContain("Activate for quotes");
    expect(component).toContain("Advanced matching details");
    expect(component).toContain('method: "PATCH"');
    expect(component).toContain("Save advanced details");
  });

  it("activates only selected company products and records the change", () => {
    expect(route).toContain("supplierProductCategory.findFirst");
    expect(route).toContain('capacityStatus: "AVAILABLE"');
    expect(route).toContain('action: "SUPPLIER.CAPABILITY_ACTIVATED"');
    expect(route).toContain("Only an owner or manager can activate supplier products");
  });
});
