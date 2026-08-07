import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { MembershipSettings } from "@/components/admin/membership-settings";

export default async function MembershipAdminPage() {
  await requireAdminPage();
  const plans = await prisma.membershipPlan.findMany({ orderBy: { displayOrder: "asc" } });
  const matching = await prisma.matchingConfiguration.findUniqueOrThrow({ where: { id: "default" } });
  const promotions = await prisma.membershipPromotion.findMany({ orderBy: [{ active: "desc" }, { startsAt: "desc" }], include: { _count: { select: { subscriptions: true } } } });
  return <>
    <AdminHeading eyebrow="Commercial and routing controls" title="Membership & matching" description="Control the three geographic plans, their Stripe prices, active opportunity limits and the automatic top-three matching rules. These settings are enforced by the backend—not just displayed in the portal."/>
    <MembershipSettings plans={plans} matching={matching} promotions={promotions.map((promotion)=>({ ...promotion, startsAt: promotion.startsAt.toISOString(), endsAt: promotion.endsAt?.toISOString() ?? null }))}/>
  </>;
}
