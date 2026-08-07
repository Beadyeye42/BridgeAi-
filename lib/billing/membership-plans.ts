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

type GeographicOverrides = Pick<SupplierCompany,
  "membershipTierOverride" |
  "maximumActiveOpportunitiesOverride" |
  "maximumServiceRadiusOverride" |
  "maximumDeliveryRadiusOverride"
>;

export function effectiveMembershipLimits(plan: MembershipPlan, company: GeographicOverrides): MembershipLimits {
  const tier = company.membershipTierOverride ?? plan.tier;
  const planRadius = tier === "NATIONWIDE" ? null : plan.maximumRadiusMiles;
  return {
    tier,
    maximumRadiusMiles: planRadius,
    nationwideAllowed: tier === "NATIONWIDE" || plan.nationwideAllowed,
    maximumActiveOpportunities: company.maximumActiveOpportunitiesOverride ?? plan.maximumActiveOpportunities,
    maximumServiceRadiusMiles: company.maximumServiceRadiusOverride ?? planRadius,
    maximumDeliveryRadiusMiles: company.maximumDeliveryRadiusOverride ?? planRadius,
  };
}

export function formatPlanPrice(monthlyPricePence: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(monthlyPricePence / 100);
}

export function planTaxLabel(plan: Pick<MembershipPlan, "taxEnabled">) {
  return plan.taxEnabled ? "+ VAT/month" : "/month · VAT not currently charged";
}
