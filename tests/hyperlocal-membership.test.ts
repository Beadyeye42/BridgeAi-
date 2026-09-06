import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN_CODES, DEFAULT_PLAN_IDS, planTaxLabel } from "@/lib/billing/membership-plans";
import { membershipPlanAdminSchema } from "@/lib/auth/validation";
import { calculateEligibleInvoiceRevenue } from "@/lib/affiliates/stripe-ledger";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Hyperlocal supplier membership", () => {
  it("has a stable free monthly identity and fixed two-mile database radius", () => {
    const migration = read("supabase/migrations/20260906221744_free_hyperlocal_two_miles.sql");
    expect(DEFAULT_PLAN_IDS.HYPERLOCAL).toBe("plan_hyperlocal_partner");
    expect(DEFAULT_PLAN_CODES.HYPERLOCAL).toBe("bridge-ai-hyperlocal-partner");
    expect(migration).toContain("'HYPERLOCAL'");
    expect(migration).toContain('"monthlyPricePence" = 0');
    expect(migration).toContain('"maximumRadiusMiles" = 2');
    expect(migration).toContain("opportunityLimitsPreserved");
    expect(migration).toContain("SYSTEM.HYPERLOCAL_MADE_FREE");
  });

  it("allows administrators to configure price, radius, ordering and Stripe price", () => {
    const parsed = membershipPlanAdminSchema.parse({
      name: "Hyperlocal Partner",
      description: "Fixed two miles",
      monthlyPricePence: 0,
      maximumRadiusMiles: 2,
      nationwideAllowed: false,
      maximumActiveOpportunities: 3,
      taxEnabled: false,
      active: true,
      providerPriceId: "price_123FreeHyperlocal",
      displayOrder: 5,
    });
    expect(parsed).toMatchObject({ monthlyPricePence: 0, maximumRadiusMiles: 2, providerPriceId: "price_123FreeHyperlocal", displayOrder: 5 });
    expect(membershipPlanAdminSchema.safeParse({ ...parsed, maximumRadiusMiles: 11 }).success).toBe(true);
    const route = read("app/api/admin/membership/plans/[id]/route.ts");
    expect(route).toContain('current.tier === "HYPERLOCAL"');
    expect(route).toContain("maximumRadiusMiles !== 2");
  });

  it("makes industry eligibility an audited administrator control", () => {
    const adminRoute = read("app/api/admin/categories/[id]/route.ts");
    const matching = read("lib/matching/suppliers.ts");
    const checkout = read("app/api/billing/subscription/checkout/route.ts");
    expect(adminRoute).toContain("hyperlocalEnabled");
    expect(adminRoute).toContain("ADMIN.INDUSTRY_HYPERLOCAL_UPDATED");
    expect(matching).toContain('planLimits?.tier === "HYPERLOCAL" && !industry?.hyperlocalEnabled');
    expect(checkout).toContain('plan.tier === "HYPERLOCAL"');
    expect(checkout).toContain("fixed 2-mile coverage area");
  });

  it("uses a separate recurring Stripe price while keeping all keys server-only", () => {
    const stripe = read("lib/stripe/server.ts");
    const checkout = read("app/api/billing/subscription/checkout/route.ts");
    expect(stripe).toContain('recurring: { interval: "month" }');
    expect(stripe).toContain("membershipTier: plan.tier");
    expect(stripe).toContain("providerPriceId: price.id");
    expect(checkout).toContain("ensureMembershipPlanStripePrice(plan)");
    expect(checkout).toContain("membershipPlanId: plan.id");
    expect(checkout).not.toContain("NEXT_PUBLIC_STRIPE_SECRET");
  });

  it("shows no VAT wording in public membership pricing", () => {
    const publicPage = read("app/page.tsx");
    const supplierPage = read("app/dashboard/subscription/page.tsx");
    expect(planTaxLabel({ taxEnabled: false })).toBe("/month");
    expect(publicPage).not.toMatch(/\bVAT\b/i);
    expect(supplierPage).not.toMatch(/\bVAT\b/i);
  });

  it("keeps affiliate revenue tied to the actual successful Hyperlocal invoice", () => {
    expect(calculateEligibleInvoiceRevenue({
      invoiceTotalPence: 0,
      invoiceTotalExcludingTaxPence: 0,
      amountPaidPence: 0,
      subscriptionLinesExcludingTaxPence: [0],
    })).toBe(0);
    const ledger = read("supabase/migrations/20260809131748_affiliate_invoice_ledger.sql");
    expect(ledger).toContain("eligible_revenue_pence::bigint * affiliate_rate");
    expect(ledger).not.toContain("0 * affiliate_rate");
  });

  it("records anonymous upgrade insight without exposing customer details", () => {
    const dashboard = read("lib/data/supplier-dashboard.ts");
    expect(dashboard).toContain("geographicMisses");
    expect(dashboard).toContain("nextPlanBandMisses");
    expect(dashboard).toContain('tier === "HYPERLOCAL"');
    expect(dashboard).not.toContain("customerContact");
  });
});
