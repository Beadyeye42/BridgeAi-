import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { lifecycleDisplay } from "@/lib/quotes/lifecycle";

export default async function AdminRequests() {
  await requireAdminPage();
  const requests = await prisma.quoteRequest.findMany({
    include: { category: true, _count: { select: { assignments: true, quotations: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const ordered = [...requests].sort((left, right) => {
    if (left._count.assignments === 0 && right._count.assignments !== 0) return -1;
    if (right._count.assignments === 0 && left._count.assignments !== 0) return 1;
    return right.createdAt.getTime() - left.createdAt.getTime();
  });
  const unassigned = requests.filter((request) => request._count.assignments === 0).length;

  return <>
    <AdminHeading
      eyebrow={`${unassigned} unassigned · ${requests.length} recent`}
      title="Quote requests"
      description="Unassigned requests are shown first so an administrator can review supplier eligibility and distribution."
    />
    <section className="panel admin-table-wrap">
      <table className="admin-table">
        <thead><tr><th>Request</th><th>Category</th><th>Area</th><th>Status</th><th>Distribution</th><th>Quotes</th></tr></thead>
        <tbody>{ordered.map((request) => <tr key={request.id}>
          <td><Link href={`/admin/requests/${request.id}`}><b>{request.title}</b><small>{request.reference}</small></Link></td>
          <td>{request.category.name}</td>
          <td>{request.deliveryPostcode}</td>
          <td><span className={`status-pill ${request.status.toLowerCase()}`}>{lifecycleDisplay(request.status)}</span></td>
          <td>{request._count.assignments === 0
            ? <span className="status-pill pending">UNASSIGNED</span>
            : `${request._count.assignments} / ${request.distributionLimit}`}</td>
          <td>{request._count.quotations}</td>
        </tr>)}</tbody>
      </table>
    </section>
  </>;
}
