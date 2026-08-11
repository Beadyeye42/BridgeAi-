import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  adaptiveOpportunityAccess,
  exposureFairnessAdjustment,
  marketDensityMode,
  selectAdaptiveSupplierMatches,
} from "../lib/matching/suppliers";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("adaptive supplier opportunity distribution", () => {
  it.each([
    [0, "EMPTY"],
    [1, "SPARSE"],
    [2, "SPARSE"],
    [4, "SPARSE"],
    [5, "HEALTHY"],
    [7, "HEALTHY"],
    [10, "HEALTHY"],
    [11, "DENSE"],
    [30, "DENSE"],
  ] as const)("classifies %i eligible suppliers as %s", (count, expected) => {
    expect(marketDensityMode(count)).toBe(expected);
  });

  it("invites every eligible supplier in a sparse market but never more than five", () => {
    const sparse = Array.from({ length: 4 }, (_, index) => ({ id: `supplier_${index}`, outcome: "MATCHED" as const }));
    const dense = Array.from({ length: 30 }, (_, index) => ({ id: `supplier_${index}`, outcome: "MATCHED" as const }));
    expect(selectAdaptiveSupplierMatches(sparse)).toHaveLength(4);
    expect(selectAdaptiveSupplierMatches(dense)).toHaveLength(5);
  });

  it("does not let high exposure exclude the only suitable supplier", () => {
    expect(adaptiveOpportunityAccess({
      density: "SPARSE",
      currentActiveOpportunities: 50,
      maximumActiveOpportunities: 5,
    })).toEqual({ allowed: true, softCapOverride: true, effectiveLimit: null });
  });

  it("uses a small healthy-market buffer and a hard dense-market plan limit", () => {
    expect(adaptiveOpportunityAccess({ density: "HEALTHY", currentActiveOpportunities: 5, maximumActiveOpportunities: 5 })).toMatchObject({ allowed: true, effectiveLimit: 6 });
    expect(adaptiveOpportunityAccess({ density: "HEALTHY", currentActiveOpportunities: 6, maximumActiveOpportunities: 5 })).toMatchObject({ allowed: false, effectiveLimit: 6 });
    expect(adaptiveOpportunityAccess({ density: "DENSE", currentActiveOpportunities: 5, maximumActiveOpportunities: 5 })).toMatchObject({ allowed: false, effectiveLimit: 5 });
  });

  it("balances exposure only between similarly qualified suppliers", () => {
    const similarNewSupplier = exposureFairnessAdjustment({
      density: "DENSE",
      baseScore: 92,
      bestBaseScore: 95,
      invitations30Days: 0,
      maximumInvitations30Days: 20,
    });
    const materiallyWeakerSupplier = exposureFairnessAdjustment({
      density: "DENSE",
      baseScore: 80,
      bestBaseScore: 95,
      invitations30Days: 0,
      maximumInvitations30Days: 20,
    });
    expect(similarNewSupplier).toBeGreaterThan(0);
    expect(similarNewSupplier).toBeLessThanOrEqual(12);
    expect(materiallyWeakerSupplier).toBe(0);
  });

  it("keeps wins out of access caps and preserves database concurrency safeguards", () => {
    const matching = read("lib/matching/suppliers.ts");
    const migration = read("supabase/migrations/20260811214821_adaptive_opportunity_distribution.sql");
    expect(matching).not.toMatch(/wins30Days\s*[>=]/);
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("request_active >= request_limit");
    expect(migration).toContain('NEW."softCapOverride" := true');
    expect(migration).toContain("capacity override requires an active platform administrator");
    expect(migration).toContain('"invitedSupplierCount" BETWEEN 0 AND 5');
  });

  it("sets the requested default plan limits and protects coverage-gap data", () => {
    const migration = read("supabase/migrations/20260811214821_adaptive_opportunity_distribution.sql");
    expect(migration).toContain("THEN 5");
    expect(migration).toContain("THEN 10");
    expect(migration).toContain("THEN 20");
    expect(migration).toContain("THEN 30");
    expect(migration).toContain('CoverageGapSignal" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('CoverageGapSignal" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain("coverage_gap_admin_read");
    expect(migration).toContain("coverage_gap_worker_manage");
  });

  it("alerts suppliers near their self-declared monthly comfort capacity without making it a win cap", () => {
    const capacityWorker = read("lib/matching/stale-capacity.ts");
    expect(capacityWorker).toContain("declaredCapacityWarningPercent");
    expect(capacityWorker).toContain("Review your monthly opportunity capacity");
    expect(capacityWorker).toContain("supplierAssignment.groupBy");
    expect(capacityWorker).not.toContain("wins30Days");
  });

  it("supports per-industry response-window overrides", () => {
    const deadlineResolver = read("lib/matching/deadlines.ts");
    const migration = read("supabase/migrations/20260811230500_industry_response_deadlines.sql");
    expect(deadlineResolver).toContain("category?.parent?.acknowledgementDeadlineHours");
    expect(deadlineResolver).toContain("category?.parent?.quotationDeadlineHours");
    expect(migration).toContain("ProductCategory_acknowledgementDeadlineHours_check");
    expect(migration).toContain("ProductCategory_quotationDeadlineHours_check");
  });
});
