import Link from "next/link";
import { Activity, Building2, FileText, ShieldAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { AdminHeading } from "@/components/admin/admin-shell";
export default async function AdminOverview() {
  const pendingSuppliers = await prisma.supplierCompany.count({
    where: { status: "PENDING" },
  });
  const openRequests = await prisma.quoteRequest.count({
    where: { status: { in: ["OPEN", "MATCHING"] } },
  });
  const openErrors = await prisma.systemEvent.count({
    where: { status: "OPEN", severity: { in: ["ERROR", "CRITICAL"] } },
  });
  const recentLogs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { actor: { select: { firstName: true, lastName: true } } },
  });
  const cards = [
    [
      "Pending suppliers",
      pendingSuppliers,
      "/admin/suppliers?status=PENDING",
      Building2,
    ],
    ["Open requests", openRequests, "/admin/requests?status=OPEN", FileText],
    ["Open errors", openErrors, "/admin/system", ShieldAlert],
  ] as const;
  return (
    <>
      <AdminHeading
        eyebrow="Ironbridge Group Ltd"
        title="Operations overview"
        description="Approve suppliers, distribute opportunities and inspect system health."
      />
      <div className="stats-grid">
        {cards.map(([label, value, href, Icon]) => (
          <Link className="stat-card" href={href} key={label}>
            <div className="stat-icon green">
              <Icon size={19} />
            </div>
            <div>
              <p>{label}</p>
              <b>{value}</b>
              <span>View records</span>
            </div>
          </Link>
        ))}
      </div>
      <section className="panel form-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Audit trail</p>
            <h2>Recent activity</h2>
          </div>
          <Activity size={20} />
        </div>
        <div className="entity-list">
          {recentLogs.map((log) => (
            <article className="entity-row" key={log.id}>
              <div>
                <b>{log.summary}</b>
                <small>
                  {log.action} ·{" "}
                  {log.actor
                    ? `${log.actor.firstName} ${log.actor.lastName}`
                    : "System"}
                </small>
                <time>{log.createdAt.toLocaleString("en-GB")}</time>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
