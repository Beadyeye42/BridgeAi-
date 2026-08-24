import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lifecycleDisplay } from "@/lib/quotes/lifecycle";
import { allowedLifecycleTransitions, configuredRequestDetails, defaultBuyerExperience, lifecycleStage, resolveBuyerExperience } from "@/lib/buyer/industry-experience";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("quote request job lifecycle", () => {
  it("uses unambiguous public labels", () => {
    expect(lifecycleDisplay("SELECTED")).toBe("Selected");
    expect(lifecycleDisplay("CONFIRMED")).toBe("Confirmed job");
    expect(lifecycleDisplay("COMPLETED")).toBe("Completed");
    expect(lifecycleDisplay("CANCELLED_AFTER_SELECTION")).toBe("Did not proceed");
  });

  it("loads stages from industry configuration rather than category slug checks", () => {
    const configured = { ...defaultBuyerExperience, stages: [
      { key: "chosen", label: "Chosen", state: "SELECTED" as const, allowedNext: ["site_visit"] },
      { key: "site_visit", label: "Site visit", state: "ACTIVE" as const, allowedNext: ["complete"] },
      { key: "complete", label: "Finished", state: "COMPLETED" as const, allowedNext: [] },
    ] };
    const resolved = resolveBuyerExperience({ buyerExperienceConfig: configured });
    expect(lifecycleStage(resolved, "site_visit").label).toBe("Site visit");
    expect(allowedLifecycleTransitions(resolved, "chosen").map((stage) => stage.key)).toEqual(["site_visit"]);
  });

  it("renders configurable request fields without knowing the industry", () => {
    const configured = { ...defaultBuyerExperience, detailFields: [{ key: "special_requirement", label: "Special requirement", type: "text" as const, source: "qualification" as const }] };
    expect(configuredRequestDetails(configured, { qualificationData: { special_requirement: "Customer supplied value" } })).toEqual([
      { key: "special_requirement", label: "Special requirement", value: "Customer supplied value" },
    ]);
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
