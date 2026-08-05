import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";

export default async function AdminSuppliers({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdminPage();
  const raw = (await searchParams).status;
  const allowed = ["PENDING", "APPROVED", "SUSPENDED", "REJECTED"] as const;
  const status = allowed.includes(raw as typeof allowed[number]) ? raw as typeof allowed[number] : undefined;
  const suppliers = await prisma.supplierCompany.findMany({
    where: status ? { status } : undefined,
    include: { _count: { select: { memberships: true, assignments: true } }, subscription: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return <>
    <AdminHeading eyebrow={`${suppliers.length} records`} title="Suppliers" description="Review onboarding evidence before approval, then monitor supplier and subscription status." />
    <nav className="filter-tabs"><Link href="/admin/suppliers">All</Link>{allowed.map((item) => <Link href={`/admin/suppliers?status=${item}`} className={status === item ? "active" : ""} key={item}>{item}</Link>)}</nav>
    <section className="panel admin-table-wrap">
      <table className="admin-table">
        <thead><tr><th>Supplier</th><th>Status</th><th>Founding place</th><th>Team</th><th>Assignments</th><th>Subscription</th><th>Actions</th></tr></thead>
        <tbody>{suppliers.map((supplier) => <tr key={supplier.id}>
          <td><Link href={`/admin/suppliers/${supplier.id}`}><b>{supplier.tradingName ?? supplier.legalName}</b><small>{supplier.contactEmail} · {supplier.postcode ?? "No postcode"}</small></Link></td>
          <td><span className={`status-pill ${supplier.status.toLowerCase()}`}>{supplier.status}</span></td>
          <td>{supplier.foundingMemberNumber ? `#${supplier.foundingMemberNumber} / 100` : "—"}</td>
          <td>{supplier._count.memberships}</td>
          <td>{supplier._count.assignments}</td>
          <td>{supplier.subscription ? <span className={`status-pill ${supplier.subscription.status.toLowerCase()}`}>{supplier.subscription.planCode} · {supplier.subscription.status}</span> : "—"}</td>
          <td><Link className="button button-outline" href={`/admin/suppliers/${supplier.id}`}>Review <ArrowUpRight size={14} /></Link></td>
        </tr>)}</tbody>
      </table>
    </section>
  </>;
}
