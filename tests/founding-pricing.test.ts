import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_PLAN_CODES, DEFAULT_PLAN_IDS } from "@/lib/billing/membership-plans";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("geographic supplier memberships", () => {
  it("defines four stable plan identities", () => {
    expect(DEFAULT_PLAN_IDS.HYPERLOCAL).toBe("plan_hyperlocal_partner");
    expect(DEFAULT_PLAN_IDS.LOCAL).toBe("plan_local_partner");
    expect(DEFAULT_PLAN_IDS.REGIONAL).toBe("plan_regional_partner");
    expect(DEFAULT_PLAN_IDS.NATIONWIDE).toBe("plan_nationwide_partner");
    expect(DEFAULT_PLAN_CODES.HYPERLOCAL).toBe("bridge-ai-hyperlocal-partner");
    expect(DEFAULT_PLAN_CODES.LOCAL).toBe("bridge-ai-local-partner");
  });

  it("creates a plan-specific recurring Stripe price and keeps tax admin controlled", () => {
    const checkout = read("app/api/billing/subscription/checkout/route.ts");
    const stripe = read("lib/stripe/server.ts");
    const webhook = read("app/api/webhooks/stripe/route.ts");
    expect(checkout).toContain("ensureMembershipPlanStripePrice(plan)");
    expect(checkout).toContain("automatic_tax: { enabled: plan.taxEnabled }");
    expect(checkout).toContain("membershipPlanId: plan.id");
    expect(stripe).toContain('recurring: { interval: "month" }');
    expect(webhook).toContain("membershipPlanId");
  });

  it("seeds and protects plan limits in PostgreSQL", () => {
    const migration = read("supabase/migrations/20260807163701_geographic_membership_intelligent_matching.sql");
    const hardening = read("supabase/migrations/20260810195356_enforce_live_geographic_membership_boundaries.sql");
    expect(migration).toContain("plan_local_partner");
    expect(migration).toContain("plan_regional_partner");
    expect(migration).toContain("plan_nationwide_partner");
    expect(migration).toContain("enforce_coverage_membership_limit");
    expect(migration).toContain("enforce_automatic_assignment_limits");
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(hardening).toContain("tier = 'LOCAL' AND \"maximumRadiusMiles\" = 40");
    expect(hardening).toContain("tier = 'REGIONAL' AND \"maximumRadiusMiles\" = 100");
    expect(hardening).toContain("manualAssignmentsEnforced");
    expect(hardening).toContain("downgradeReconciliationEnabled");
  });
});
