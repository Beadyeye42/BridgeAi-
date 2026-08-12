import type { FulfilmentMode, MembershipPlan, Prisma, SupplierCompany, Subscription } from "@prisma/client";
import { effectiveMembershipLimits } from "@/lib/billing/membership-plans";
import { isMembershipActive } from "@/lib/billing/pricing";
import { distanceMiles } from "@/lib/matching/coverage";

type CompanyWithMembership = Pick<SupplierCompany,
  "membershipTierOverride" |
  "maximumActiveOpportunitiesOverride" |
  "maximumServiceRadiusOverride" |
  "maximumDeliveryRadiusOverride"
> & {
  geographicOriginLatitude: Prisma.Decimal | number | null;
  geographicOriginLongitude: Prisma.Decimal | number | null;
  subscription: (Pick<Subscription, "status" | "currentPeriodEnd"> & {
    membershipPlan: MembershipPlan | null;
  }) | null;
};

type OpportunityLocation = {
  deliveryLatitude: Prisma.Decimal | number | null;
  deliveryLongitude: Prisma.Decimal | number | null;
  fulfilmentMode: FulfilmentMode;
};

export function hasCurrentGeographicOpportunityAccess(
  company: CompanyWithMembership,
  request: OpportunityLocation,
  now = new Date(),
) {
  if (!isMembershipActive(company.subscription, now) || !company.subscription?.membershipPlan) return false;

  const limits = effectiveMembershipLimits(company.subscription.membershipPlan, company);
  const purposeRadius = ["SERVICE", "INSTALLATION"].includes(request.fulfilmentMode)
    ? limits.maximumServiceRadiusMiles
    : limits.maximumDeliveryRadiusMiles;

  // An unrestricted Nationwide membership has no mileage ceiling. Any
  // administrator restriction converts it back into a mileage-controlled plan.
  if (purposeRadius === null) return limits.nationwideAllowed;

  if (
    company.geographicOriginLatitude === null ||
    company.geographicOriginLongitude === null ||
    request.deliveryLatitude === null ||
    request.deliveryLongitude === null
  ) return false;

  const miles = distanceMiles(
    {
      latitude: Number(company.geographicOriginLatitude),
      longitude: Number(company.geographicOriginLongitude),
    },
    {
      latitude: Number(request.deliveryLatitude),
      longitude: Number(request.deliveryLongitude),
    },
  );
  return miles <= purposeRadius + 0.01;
}

export function canReadSupplierAssignment(
  company: CompanyWithMembership,
  assignment: { quotation: unknown | null; quoteRequest: OpportunityLocation },
  now = new Date(),
) {
  // Preserve the supplier's auditable quotation history after cancellation or
  // downgrade. Unquoted live opportunities always use the current paid tier.
  return assignment.quotation !== null
    || hasCurrentGeographicOpportunityAccess(company, assignment.quoteRequest, now);
}
