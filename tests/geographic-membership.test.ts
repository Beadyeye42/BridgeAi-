import fs from "node:fs";
import path from "node:path";
import type { MembershipPlan } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { effectiveMembershipLimits } from "../lib/billing/membership-plans";
import { matchCoverageRule, type CoverageRule } from "../lib/matching/coverage";
import { evaluateCapability } from "../lib/matching/suppliers";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

function plan(tier: "HYPERLOCAL" | "LOCAL" | "REGIONAL" | "NATIONWIDE", maximumRadiusMiles: number | null, maximumActiveOpportunities: number): MembershipPlan {
  return {
    id: `plan_${tier.toLowerCase()}`, code: tier.toLowerCase(), name: tier, tier, description: null,
    monthlyPricePence: 2999, currency: "GBP", maximumRadiusMiles, nationwideAllowed: tier === "NATIONWIDE",
    maximumActiveOpportunities, taxEnabled: false, providerProductId: null, providerPriceId: null,
    active: true, displayOrder: 1, createdAt: new Date(), updatedAt: new Date(),
  };
}

const noOverrides = { membershipTierOverride: null, maximumActiveOpportunitiesOverride: null, maximumServiceRadiusOverride: null, maximumDeliveryRadiusOverride: null };
const centre = { latitude: 51.9, longitude: -2.1 };
const destination = (miles: number) => ({ postcode: "TEST", latitude: centre.latitude, longitude: centre.longitude + miles / (69 * Math.cos(centre.latitude * Math.PI / 180)) });
const rule = (radiusMiles: number): CoverageRule => ({ type: "DISTANCE", label: "Company base", postcodePrefix: null, centrePostcode: "GL52 6TD", radiusMiles, latitude: centre.latitude, longitude: centre.longitude });

describe("geographic memberships and controlled distribution", () => {
  it("accepts 39 miles and rejects 41 miles for Local", () => {
    expect(matchCoverageRule(rule(40), destination(39))).not.toBeNull();
    expect(matchCoverageRule(rule(40), destination(41))).toBeNull();
  });

  it("accepts the selected Hyperlocal radius and rejects work beyond it", () => {
    expect(matchCoverageRule(rule(7), destination(6))).not.toBeNull();
    expect(matchCoverageRule(rule(7), destination(8))).toBeNull();
    expect(effectiveMembershipLimits(plan("HYPERLOCAL", 10, 3), noOverrides)).toMatchObject({
      tier: "HYPERLOCAL",
      maximumRadiusMiles: 10,
      maximumActiveOpportunities: 3,
      nationwideAllowed: false,
    });
  });

  it("accepts 80 miles and rejects 105 miles for Regional", () => {
    expect(matchCoverageRule(rule(100), destination(80))).not.toBeNull();
    expect(matchCoverageRule(rule(100), destination(105))).toBeNull();
  });

  it("keeps Nationwide geographically eligible without overriding capability checks", () => {
    const nationwide: CoverageRule = { type: "NATIONWIDE", label: "Great Britain", postcodePrefix: null, centrePostcode: null, radiusMiles: null, latitude: null, longitude: null };
    expect(matchCoverageRule(nationwide, { postcode: "IV1 1AA", latitude: null, longitude: null })).not.toBeNull();
    expect(read("lib/matching/suppliers.ts")).toContain('mandatoryRejections.push("Supplier has not selected this product category")');
  });

  it("applies downgrade and upgrade limits immediately from the selected plan", () => {
    expect(effectiveMembershipLimits(plan("LOCAL", 40, 5), noOverrides)).toMatchObject({ maximumRadiusMiles: 40, maximumActiveOpportunities: 5, nationwideAllowed: false });
    expect(effectiveMembershipLimits(plan("REGIONAL", 100, 10), noOverrides)).toMatchObject({ maximumRadiusMiles: 100, maximumActiveOpportunities: 10, nationwideAllowed: false });
    expect(effectiveMembershipLimits(plan("NATIONWIDE", null, 20), noOverrides)).toMatchObject({ maximumRadiusMiles: null, maximumActiveOpportunities: 20, nationwideAllowed: true });
  });

  it("never lets company overrides expand the purchased geography", () => {
    const attemptedExpansion = {
      membershipTierOverride: "NATIONWIDE" as const,
      maximumActiveOpportunitiesOverride: 99,
      maximumServiceRadiusOverride: 500,
      maximumDeliveryRadiusOverride: 500,
    };
    expect(effectiveMembershipLimits(plan("LOCAL", 40, 5), attemptedExpansion)).toMatchObject({
      tier: "LOCAL",
      maximumRadiusMiles: 40,
      maximumServiceRadiusMiles: 40,
      maximumDeliveryRadiusMiles: 40,
      maximumActiveOpportunities: 5,
      nationwideAllowed: false,
    });
    expect(effectiveMembershipLimits(plan("REGIONAL", 100, 10), { ...attemptedExpansion, membershipTierOverride: "LOCAL" })).toMatchObject({
      tier: "LOCAL",
      maximumRadiusMiles: 40,
      nationwideAllowed: false,
    });
  });

  it("reduces confidence when capacity is stale using the configured period", () => {
    const now = new Date("2026-08-07T12:00:00Z");
    const capability = {
      id: "cap_1", manufacturerNames: [], systemNames: [], colourNames: [], finishNames: [], minimumOrderValue: null,
      minimumOrderQuantity: null, standardLeadTimeDays: 14, urgentLeadTimeDays: null, currentLeadTimeDays: 14,
      collectionAvailable: false, supportsSupplyOnly: true, supportsDelivery: true, supportsInstallation: false, supportsService: false,
      deliveryDays: [1,2,3,4,5], capacityStatus: "AVAILABLE" as const, shortageNote: null, shortageUntil: null,
      lastConfirmedAt: now, capacityLastConfirmedAt: now, leadTimeLastConfirmedAt: now,
    };
    const request = { id: "request", categoryId: "windows", deliveryPostcode: "GL52 6TD", deliveryLatitude: centre.latitude, deliveryLongitude: centre.longitude, fulfilmentMode: "DELIVERY" as const, items: [{ quantity: 1 }] };
    const coverage = { type: "DISTANCE" as const, label: "Company base", description: "Inside delivery radius", distanceMiles: 10 };
    const fresh = evaluateCapability(request, capability, coverage, now, { capacityStaleDays: 7 });
    const stale = evaluateCapability(request, { ...capability, capacityLastConfirmedAt: new Date("2026-07-20T12:00:00Z") }, coverage, now, { capacityStaleDays: 7 });
    expect(stale.score).toBeLessThan(fresh.score);
    expect(stale.reasons.some((reason) => reason.includes("confidence is reduced"))).toBe(true);
  });

  it("enforces server and database controls instead of trusting browser radius values", () => {
    const api = read("app/api/supplier/coverage/route.ts");
    const migration = read("supabase/migrations/20260810195356_enforce_live_geographic_membership_boundaries.sql");
    expect(api).toContain("offsetFromCompanyBase + parsed.data.radiusMiles > purposeRadius");
    expect(api).toContain("!limits.nationwideAllowed || purposeRadius !== null");
    expect(api).toContain("Postcode-area rules are no longer used");
    expect(migration).toContain("coverage boundary exceeds the membership or onboarding radius from the company base");
    expect(migration).toContain("assignment would exceed the active supplier limit");
    expect(migration).toContain("opportunity is outside the supplier current membership radius");
    expect(migration).toContain("NOT limits.nationwide OR permitted IS NOT NULL");
    expect(migration).not.toContain('NEW."assignedById" IS NOT NULL');
    expect(migration).toContain("reconcile_supplier_geographic_membership");
    expect(migration).toContain("tier = 'LOCAL' AND \"maximumRadiusMiles\" = 40");
    expect(migration).toContain("tier = 'REGIONAL' AND \"maximumRadiusMiles\" = 100");
  });

  it("checks live requests from the registered company base as well as saved coverage", () => {
    const matching = read("lib/matching/suppliers.ts");
    expect(matching).toContain("companyDistance > purposeRadius");
    expect(matching).toContain("Registered company-base coordinates are required");
    expect(matching).toContain("effectiveRadiusMiles: purposeRadius");
  });

  it("allows safe pre-plan onboarding geography without opening lead access", () => {
    const api = read("app/api/supplier/coverage/route.ts");
    const page = read("app/dashboard/coverage/page.tsx");
    const migration = read("supabase/migrations/20260810193926_allow_preplan_onboarding_coverage.sql");
    const originalMembershipMigration = read("supabase/migrations/20260807163701_geographic_membership_intelligent_matching.sql");
    expect(api).toContain("isMembershipActive(company.subscription)");
    expect(page).toContain("isMembershipActive(company.subscription)");
    expect(migration).toContain("coverage_configuration_limits");
    expect(migration).toContain("'plan_local_partner'");
    expect(migration).toContain("coverage_configuration_limits(NEW.\"supplierCompanyId\")");
    expect(originalMembershipMigration).toContain("effective_membership_limits(NEW.\"supplierCompanyId\")");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION bridge_private.enforce_automatic_assignment_limits");
    expect(migration).toContain("SYSTEM.PREPLAN_COVERAGE_ENABLED");
  });

  it("keeps upgrade statistics anonymous and replacement invitations ranked", () => {
    const dashboard = read("lib/data/supplier-dashboard.ts");
    const replacement = read("lib/matching/replacements.ts");
    expect(dashboard).toContain("select: { reasons: true, distanceMiles: true }");
    expect(dashboard).not.toContain("customerContact");
    expect(replacement).toContain("inviteNextEligibleSupplier");
    expect(replacement).toContain("invitationRank: totalInvitations + 1");
  });

  it("retires free-for-all opportunity claiming and limits automatic competition to five", () => {
    const claimRoute = read("app/api/opportunities/[reference]/claim/route.ts");
    const processor = read("lib/whatsapp/processor.ts");
    const migration = read("supabase/migrations/20260807163701_geographic_membership_intelligent_matching.sql");
    expect(claimRoute).toContain("status: 410");
    expect(claimRoute).toContain("Open opportunity claiming has been retired");
    expect(processor).toContain("maximumSuppliersPerRequest ?? 5, 5");
    expect(migration).toContain("automatic assignment would exceed the active supplier limit");
  });

  it("keeps promotions separate from plans and enforces them in Stripe and PostgreSQL", () => {
    const checkout = read("app/api/billing/subscription/checkout/route.ts");
    const stripe = read("lib/stripe/server.ts");
    const migration = read("supabase/migrations/20260807163701_geographic_membership_intelligent_matching.sql");
    const followup = read("supabase/migrations/20260807184500_geographic_membership_stripe_promotion_read.sql");
    expect(checkout).toContain('runAsDatabaseWorker("stripe_billing"');
    expect(checkout).toContain("eligiblePlanCodes: { has: plan.code }");
    expect(stripe).toContain("ensureMembershipPromotionStripeCoupon");
    expect(migration).toContain("enforce_membership_promotion_claim");
    expect(followup).toContain("promotion_stripe_worker_select");
  });

  it("uses separate service, delivery and collection geography", () => {
    const matching = read("lib/matching/suppliers.ts");
    const transport = read("lib/categories/transport.ts");
    expect(matching).toContain("matchingCoveragePurpose");
    expect(matching).toContain('purpose === "SERVICE"');
    expect(matching).toContain('purpose === "DELIVERY"');
    expect(matching).toContain('request.fulfilmentMode === "COLLECTION"');
    expect(matching).toContain("supplier.collectionLocations");
    expect(transport).toContain('return "DELIVERY" as const');
  });
});
