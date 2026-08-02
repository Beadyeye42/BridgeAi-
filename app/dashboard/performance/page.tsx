import { Clock3, Target, TrendingUp } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
export const dynamic = "force-dynamic";
export default async function PerformancePage() {
  const { session, companyId } = await requireSupplierPage();
  const company = await prisma.supplierCompany.findUniqueOrThrow({
    where: { id: companyId },
  });
  const assignments = await prisma.supplierAssignment.findMany({
    where: { supplierCompanyId: companyId, respondedAt: { not: null } },
    select: { assignedAt: true, respondedAt: true },
  });
  const submitted = await prisma.supplierQuotation.count({
    where: {
      supplierCompanyId: companyId,
      status: { in: ["SUBMITTED", "ACCEPTED", "REJECTED"] },
    },
  });
  const won = await prisma.supplierQuotation.count({
    where: { supplierCompanyId: companyId, status: "ACCEPTED" },
  });
  const avg = assignments.length
    ? assignments.reduce(
        (sum, a) =>
          sum +
          ((a.respondedAt?.getTime() ?? a.assignedAt.getTime()) -
            a.assignedAt.getTime()),
        0,
      ) / assignments.length
    : null;
  const stats = [
    [
      "Average response",
      avg ? `${Math.max(1, Math.round(avg / 3600000))} hours` : "—",
      Clock3,
    ],
    ["Quotations submitted", String(submitted), TrendingUp],
    [
      "Win rate",
      submitted ? `${Math.round((won / submitted) * 100)}%` : "—",
      Target,
    ],
  ] as const;
  return (
    <PortalPage
      {...identity(session, company)}
      eyebrow="Measured from recorded activity"
      title="Performance"
      description="Response and outcome metrics for this supplier company."
    >
      <div className="stats-grid">
        {stats.map(([label, value, Icon]) => (
          <article className="stat-card" key={label}>
            <div className="stat-icon green">
              <Icon size={19} />
            </div>
            <div>
              <p>{label}</p>
              <b>{value}</b>
              <span>Company-wide</span>
            </div>
          </article>
        ))}
      </div>
      <div className="honesty-note">
        Metrics use completed, audit-backed supplier activity. Rankings and peer
        benchmarks are not shown until a statistically meaningful comparison
        cohort exists.
      </div>
    </PortalPage>
  );
}
