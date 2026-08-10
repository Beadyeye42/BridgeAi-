import type { MembershipPlan, MembershipTier, SupplierCompany } from "@prisma/client";

export const DEFAULT_PLAN_IDS: Record<MembershipTier, string> = {
  LOCAL: "plan_local_partner",
  REGIONAL: "plan_regional_partner",
  NATIONWIDE: "plan_nationwide_partner",
};

export const DEFAULT_PLAN_CODES: Record<MembershipTier, string> = {
  LOCAL: "bridge-ai-local-partner",
  REGIONAL: "bridge-ai-regional-partner",
  NATIONWIDE: "bridge-ai-nationwide-partner",
};

export type MembershipLimits = {
  tier: MembershipTier;
  maximumRadiusMiles: number | null;
  nationwideAllowed: boolean;
  maximumActiveOpportunities: number;
  maximumServiceRadiusMiles: number | null;
  maximumDeliveryRadiusMiles: number | null;
};

const TIER_RANK: Record<MembershipTier, number> = { LOCAL: 1, REGIONAL: 2, NATIONWIDE: 3 };
const TIER_RADIUS: Record<MembershipTier, number | null> = { LOCAL: 40, REGIONAL: 100, NATIONWIDE: null };

function restrictedTier(planTier: MembershipTier, override: MembershipTier | null): MembershipTier {
  if (!override || TIER_RANK[override] > TIER_RANK[planTier]) return planTier;
  return override;
}

function restrictedNumber(override: number | null, purchasedLimit: number): number {
  return override === null ? purchasedLimit : Math.min(override, purchasedLimit);
}

function restrictedRadius(override: number | null, purchasedLimit: number | null): number | null {
  if (purchasedLimit === null) return override;
  return override === null ? purchasedLimit : Math.min(override, purchasedLimit);
}

type GeographicOverrides = Pick<SupplierCompany,
  "membershipTierOverride" |
  "maximumActiveOpportunitiesOverride" |
  "maximumServiceRadiusOverride" |
  "maximumDeliveryRadiusOverride"
>;

export function effectiveMembershipLimits(plan: MembershipPlan, company: GeographicOverrides): MembershipLimits {
  // Company overrides are safety restrictions only. They must never turn a
  // Local subscription into Regional or Nationwide access without an upgrade.
  const tier = restrictedTier(plan.tier, company.membershipTierOverride);
  const canonicalTierRadius = TIER_RADIUS[tier];
  const purchasedRadius = plan.maximumRadiusMiles === null
    ? canonicalTierRadius
    : canonicalTierRadius === null
      ? plan.maximumRadiusMiles
      : Math.min(plan.maximumRadiusMiles, canonicalTierRadius);
  return {
    tier,
    maximumRadiusMiles: purchasedRadius,
    nationwideAllowed: tier === "NATIONWIDE" && plan.tier === "NATIONWIDE" && plan.nationwideAllowed,
    maximumActiveOpportunities: restrictedNumber(company.maximumActiveOpportunitiesOverride, plan.maximumActiveOpportunities),
    maximumServiceRadiusMiles: restrictedRadius(company.maximumServiceRadiusOverride, purchasedRadius),
    maximumDeliveryRadiusMiles: restrictedRadius(company.maximumDeliveryRadiusOverride, purchasedRadius),
  };
}

export function formatPlanPrice(monthlyPricePence: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(monthlyPricePence / 100);
}

export function planTaxLabel(plan: Pick<MembershipPlan, "taxEnabled">) {
  return plan.taxEnabled ? "+ VAT/month" : "/month · VAT not currently charged";
}
