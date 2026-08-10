import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isMembershipActive } from "@/lib/billing/pricing";

describe("supplier quotation membership access", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");

  it("keeps a scheduled cancellation active until the paid period ends", () => {
    expect(isMembershipActive({
      status: "ACTIVE",
      currentPeriodEnd: new Date("2026-09-10T12:00:00.000Z"),
    }, now)).toBe(true);
  });

  it("fails closed when the paid period has elapsed", () => {
    expect(isMembershipActive({
      status: "ACTIVE",
      currentPeriodEnd: new Date("2026-08-10T11:59:59.000Z"),
    }, now)).toBe(false);
    expect(isMembershipActive({ status: "CANCELLED", currentPeriodEnd: null }, now)).toBe(false);
  });

  it("enforces access in the API, database trigger, RLS and expiry worker", () => {
    const route = readFileSync("app/api/quotations/route.ts", "utf8");
    const decision = readFileSync("app/api/assignments/[id]/decision/route.ts", "utf8");
    const migration = readFileSync("supabase/migrations/20260810205306_enforce_subscription_quotation_access.sql", "utf8");
    const cron = readFileSync("app/api/cron/monitor-production/route.ts", "utf8");

    expect(route).toContain("MEMBERSHIP_REQUIRED");
    expect(route).toContain("ACTIVE_MEMBERSHIP_REQUIRED");
    expect(decision).toContain("isMembershipActive(subscription)");
    expect(migration).toContain("has_active_supplier_subscription");
    expect(migration).toContain("ACTIVE_MEMBERSHIP_REQUIRED");
    expect(migration).toContain("reconcile_supplier_subscription_access");
    expect(migration).toContain("DROP POLICY IF EXISTS assignment_company_update");
    expect(migration).not.toContain("OR assignment.status IN ('DECLINED'");
    expect(migration).toContain("historicalQuotationReadAccess");
    expect(cron).toContain("expireElapsedMemberships");
  });
});
