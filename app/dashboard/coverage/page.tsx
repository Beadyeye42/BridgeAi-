import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import { CoverageManager } from "@/components/dashboard/management-forms";
import { DEFAULT_PLAN_IDS, effectiveMembershipLimits } from "@/lib/billing/membership-plans";
import { isMembershipActive } from "@/lib/billing/pricing";

export const dynamic = "force-dynamic";

export default async function CoveragePage() {
  const { session, companyId } = await requireSupplierPage();
  const company = await prisma.supplierCompany.findUniqueOrThrow({
    where: { id: companyId },
    include: {
      coverageAreas: { where: { active: true }, orderBy: [{ purpose: "asc" }, { createdAt: "asc" }] },
      collectionLocations: { where: { active: true }, orderBy: { createdAt: "asc" } },
      subscription: { include: { membershipPlan: true } },
    },
  });
  const activeSubscription = isMembershipActive(company.subscription) ? company.subscription : null;
  const plan = activeSubscription?.membershipPlan
    ?? await prisma.membershipPlan.findUnique({ where: { id: DEFAULT_PLAN_IDS.LOCAL } });
  const limits = plan ? effectiveMembershipLimits(plan, company) : null;

  return <PortalPage
    {...identity(session, company)}
    eyebrow="Geographic matching"
    title="Service, delivery & collection"
    description="Tell Bridge AI where you install or service, where you deliver products, and where buyers can collect. These are kept separate for accurate matching."
  >
    <CoverageManager
      areas={company.coverageAreas.map((area) => ({
        id: area.id,
        type: area.type,
        purpose: area.purpose,
        label: area.label,
        postcodePrefix: area.postcodePrefix,
        centrePostcode: area.centrePostcode,
        radiusMiles: area.radiusMiles,
      }))}
      collections={company.collectionLocations.map((location) => ({
        id: location.id,
        label: location.label,
        postcode: location.postcode,
        collectionDays: location.collectionDays,
        noticeRequired: location.noticeRequired,
        noticeHours: location.noticeHours,
      }))}
      plan={plan && limits ? {
        name: plan.name,
        tier: limits.tier,
        maximumRadiusMiles: limits.maximumRadiusMiles,
        maximumServiceRadiusMiles: limits.maximumServiceRadiusMiles,
        maximumDeliveryRadiusMiles: limits.maximumDeliveryRadiusMiles,
        nationwideAllowed: limits.nationwideAllowed,
        maximumActiveOpportunities: limits.maximumActiveOpportunities,
        onboardingDefault: !activeSubscription?.membershipPlan,
      } : null}
      companyBasePostcode={company.geographicOriginPostcode ?? company.postcode ?? ""}
    />
  </PortalPage>;
}
