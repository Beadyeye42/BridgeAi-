import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { MembershipSettings } from "@/components/admin/membership-settings";

export default async function MembershipAdminPage() {
  await requireAdminPage();
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  // Keep RLS-scoped work sequential for the deliberately small production pool.
  const plans = await prisma.membershipPlan.findMany({ orderBy: { displayOrder: "asc" } });
  const matching = await prisma.matchingConfiguration.findUniqueOrThrow({ where: { id: "default" } });
  const promotions = await prisma.membershipPromotion.findMany({ orderBy: [{ active: "desc" }, { startsAt: "desc" }], include: { _count: { select: { subscriptions: true } } } });
  const hyperlocalSubscriptions = await prisma.subscription.findMany({
    where: { membershipPlan: { tier: "HYPERLOCAL" } },
    include: { membershipPlan: true, supplierCompany: { select: { county: true, coverageAreas: { where: { active: true, type: "DISTANCE" }, select: { radiusMiles: true } } } } },
  });
  const hyperlocalIndustries = await prisma.productCategory.count({ where: { parentId: null, hyperlocalEnabled: true } });
  const planChanges = await prisma.auditLog.findMany({ where: { action: "BILLING.MEMBERSHIP_PLAN_CHANGED", createdAt: { gte: since } }, select: { metadata: true } });
  const activeHyperlocal = hyperlocalSubscriptions.filter((subscription) => subscription.status === "ACTIVE" && (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > now));
  const hyperlocalMrr = activeHyperlocal.reduce((sum, subscription) => sum + subscription.membershipPlan!.monthlyPricePence, 0);
  const endingHyperlocal = hyperlocalSubscriptions.filter((subscription) => subscription.cancelAtPeriodEnd || subscription.status === "CANCELLED").length;
  const radii = activeHyperlocal.flatMap((subscription) => subscription.supplierCompany.coverageAreas.map((area) => area.radiusMiles).filter((radius): radius is number => radius !== null));
  const averageRadius = radii.length ? radii.reduce((sum, radius) => sum + radius, 0) / radii.length : 0;
  const directions = planChanges.map((change) => change.metadata && typeof change.metadata === "object" && !Array.isArray(change.metadata) ? String((change.metadata as Record<string, unknown>).direction ?? "") : "");
  const upgrades = directions.filter((direction) => direction === "UPGRADE").length;
  const downgrades = directions.filter((direction) => direction === "DOWNGRADE").length;
  const counties = Object.entries(activeHyperlocal.reduce<Record<string, number>>((totals, subscription) => {
    const county = subscription.supplierCompany.county?.trim() || "County not supplied";
    totals[county] = (totals[county] ?? 0) + 1;
    return totals;
  }, {})).sort((left, right) => right[1] - left[1]).slice(0, 5);
  return <>
    <AdminHeading eyebrow="Commercial and routing controls" title="Membership & matching" description="Control the four geographic plans, their Stripe prices, active opportunity limits and automatic matching of up to five suppliers. These settings are enforced by the backend—not just displayed in the portal."/>
    <section className="panel form-section spaced-section"><div className="section-heading"><div><p className="eyebrow">Hyperlocal reporting</p><h2>Hyperlocal Partner overview</h2></div></div><div className="stats-grid"><article className="stat-card"><span>Active suppliers</span><strong>{activeHyperlocal.length}</strong><small>Currently inside a paid or complimentary period</small></article><article className="stat-card"><span>Listed monthly value</span><strong>{new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(hyperlocalMrr / 100)}</strong><small>Based on current plan prices; Stripe remains the payment source of truth</small></article><article className="stat-card"><span>Ending or cancelled</span><strong>{endingHyperlocal}</strong><small>Access ends at the recorded paid-period boundary</small></article><article className="stat-card"><span>Average selected radius</span><strong>{averageRadius.toFixed(1)} mi</strong><small>Across active distance coverage rules</small></article><article className="stat-card"><span>Enabled industries</span><strong>{hyperlocalIndustries}</strong><small>Controlled in the Industries admin area</small></article><article className="stat-card"><span>30-day plan movement</span><strong>{upgrades} / {downgrades}</strong><small>Upgrades / downgrades recorded in the audit trail</small></article></div>{counties.length > 0 && <div className="entity-list"><div className="section-subheading">Geographic distribution</div>{counties.map(([county, count]) => <div className="entity-row" key={county}><div><b>{county}</b><small>Active Hyperlocal supplier companies</small></div><strong>{count}</strong></div>)}</div>}</section>
    <MembershipSettings plans={plans} matching={matching} promotions={promotions.map((promotion)=>({ ...promotion, startsAt: promotion.startsAt.toISOString(), endsAt: promotion.endsAt?.toISOString() ?? null }))}/>
  </>;
}
