import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lifecycleDisplay, supplierSelectionNextStep } from "@/lib/quotes/lifecycle";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("quote request job lifecycle", () => {
  it("uses unambiguous public labels", () => {
    expect(lifecycleDisplay("SELECTED")).toBe("Selected");
    expect(lifecycleDisplay("CONFIRMED")).toBe("Confirmed job");
    expect(lifecycleDisplay("COMPLETED")).toBe("Completed");
    expect(lifecycleDisplay("CANCELLED_AFTER_SELECTION")).toBe("Did not proceed");
  });

  it("provides industry-specific next steps", () => {
    expect(supplierSelectionNextStep("composite-doors", "windows")).toContain("survey");
    expect(supplierSelectionNextStep("man-with-a-van", "transport-delivery-removals")).toContain("collection");
    expect(supplierSelectionNextStep("steel-frames", "bespoke-metal-fabrication")).toContain("drawings");
    expect(supplierSelectionNextStep("plant-hire")).toContain("equipment availability");
  });

  it("records every supplier transition in the same transaction", () => {
    const route = read("app/api/supplier/requests/[reference]/lifecycle/route.ts");
    expect(route).toContain("Prisma.TransactionIsolationLevel.Serializable");
    expect(route).toContain("FOR UPDATE");
    expect(route).toContain("writeAuditLog");
    expect(route).toContain("current.quotations.length !== 1");
  });

  it("enforces ordered lifecycle transitions in PostgreSQL", () => {
    const migration = read("supabase/migrations/20260811233745_apply_quote_request_lifecycle.sql");
    expect(migration).toContain("job can only be confirmed after customer selection");
    expect(migration).toContain("job can only be completed after confirmation");
    expect(migration).toContain("selected job lifecycle requires exactly one accepted quotation");
    expect(migration).toContain("final job lifecycle state cannot be changed");
  });
});
