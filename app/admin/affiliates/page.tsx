import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { AffiliateCreateForm, AffiliateStatusControl } from "@/components/admin/affiliate-manager";
import { money } from "@/lib/affiliates/display";

export default async function AdminAffiliatesPage() {
  await requireAdminPage();
  const programme = await prisma.affiliateProgramme.findUniqueOrThrow({ where: { id: "default" } });
  const affiliates = await prisma.affiliate.findMany({ include: { user: true, _count: { select: { clicks: true, referrals: true } }, commissions: true }, orderBy: { createdAt: "desc" } });
  const totals = await prisma.affiliateCommission.aggregate({ _sum: { eligibleRevenuePence: true, commissionAmountPence: true } });
  const activeCount = affiliates.filter((affiliate) => affiliate.status === "ACTIVE").length;
  return <><AdminHeading eyebrow={`${activeCount} of ${programme.maximumActive} active places used`} title="Affiliates" description="Create approved affiliate accounts and inspect invoice-backed referrals, commission and payouts." />
    <div className="stats-grid"><article className="stat-card"><span>Total affiliates</span><strong>{affiliates.length}</strong><small>{activeCount} active</small></article><article className="stat-card"><span>Referred suppliers</span><strong>{affiliates.reduce((sum, item) => sum + item._count.referrals, 0)}</strong></article><article className="stat-card"><span>Referred subscription revenue</span><strong>{money(totals._sum.eligibleRevenuePence ?? 0)}</strong></article><article className="stat-card"><span>Net commissions</span><strong>{money(totals._sum.commissionAmountPence ?? 0)}</strong></article></div>
    <div className="dashboard-grid"><section className="panel panel-wide"><div className="panel-heading"><div><p className="eyebrow">Programme accounts</p><h2>Affiliate oversight</h2></div></div><div className="table-wrap"><table className="admin-table"><thead><tr><th>Affiliate</th><th>Code</th><th>Clicks</th><th>Referrals</th><th>Commission</th><th>Status</th></tr></thead><tbody>{affiliates.map((affiliate) => <tr key={affiliate.id}><td><Link href={`/admin/affiliates/${affiliate.id}`}><b>{affiliate.displayName}</b><small>{affiliate.user.email}</small></Link></td><td>{affiliate.code}</td><td>{affiliate._count.clicks}</td><td>{affiliate._count.referrals}</td><td>{money(affiliate.commissions.filter((entry) => entry.status !== "REVERSED").reduce((sum, entry) => sum + entry.commissionAmountPence, 0))}</td><td><AffiliateStatusControl id={affiliate.id} status={affiliate.status} /></td></tr>)}</tbody></table></div></section><aside className="panel"><p className="eyebrow">Administrator only</p><h2>Create affiliate</h2><AffiliateCreateForm /></aside></div>
  </>;
}
