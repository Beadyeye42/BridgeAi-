export const FOUNDING_SUPPLIER_LIMIT = 100;
export const INTRODUCTORY_MONTHS = 6;
export const INTRODUCTORY_PRICE_PENCE = 2_999;
export const STANDARD_PRICE_PENCE = 4_999;
export const FOUNDING_PLAN_CODE = "bridge-ai-founding-supplier";
export const COMPLIMENTARY_PLAN_CODE = "bridge-ai-complimentary";

export function isFoundingSupplier(number: number | null | undefined) {
  return typeof number === "number" && number >= 1 && number <= FOUNDING_SUPPLIER_LIMIT;
}

export function isMembershipActive(
  subscription: { status: string; currentPeriodEnd: Date | null } | null | undefined,
  now = new Date(),
) {
  return subscription?.status === "ACTIVE"
    && (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > now);
}

export function isComplimentaryMembership(
  subscription: { accessSource: string } | null | undefined,
) {
  return subscription?.accessSource === "COMPLIMENTARY";
}
