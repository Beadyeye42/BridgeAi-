import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { affiliateStatusLabel, money } from "@/lib/affiliates/display";
import { AffiliateInvitationControl, AffiliatePayoutControls, AffiliateStatusControl } from "@/components/admin/affiliate-manager";

export default async function AdminAffiliateDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage(); const { id } = await params;
  const affiliate = await prisma.affiliate.findUnique({ where: { id }, include: {
    user: true,
    referrals: { include: { supplierCompany: { include: { subscription: { include: { membershipPlan: true } } } } }, orderBy: { referredAt: "desc" } },
    commissions: { include: { supplierCompany: { select: { legalName: true } } }, orderBy: { earnedAt: "desc" }, take: 100 },
    payouts: { orderBy: { periodEnd: "desc" } },
    auditLogs: { orderBy: { createdAt: "desc" }, take: 50 },
  } });
  if (!affiliate) notFound();
  return <><AdminHeading eyebrow={affiliate.code} title={affiliate.displayName} description={`${affiliate.user.email} · permanent attribution and accounting history`} actions={<><AffiliateInvitationControl id={affiliate.id} /><AffiliateStatusControl id={affiliate.id} status={affiliate.status} /></>} />
    <div className="stats-grid"><article className="stat-card"><span>Referrals</span><strong>{affiliate.referrals.length}</strong></article><article className="stat-card"><span>Qualification</span><strong>{affiliate.referrals.filter((item) => item.status === "QUALIFICATION_MONTH").length}</strong></article><article className="stat-card"><span>Commission active</span><strong>{affiliate.referrals.filter((item) => item.status === "COMMISSION_ACTIVE").length}</strong></article><article className="stat-card"><span>Net ledger commission</span><strong>{money(affiliate.commissions.filter((item) => item.status !== "REVERSED").reduce((sum, item) => sum + item.commissionAmountPence, 0))}</strong></article></div>
    <section className="panel"><p className="eyebrow">Referral customers</p><h2>Subscriptions and progress</h2><div className="table-wrap"><table className="admin-table"><thead><tr><th>Supplier</th><th>Plan</th><th>Subscription</th><th>Referral</th><th>Paid periods</th><th>Commission months</th></tr></thead><tbody>{affiliate.referrals.map((referral) => <tr key={referral.id}><td>{referral.supplierCompany.legalName}</td><td>{referral.supplierCompany.subscription?.membershipPlan?.name ?? "—"}</td><td>{affiliateStatusLabel(referral.supplierCompany.subscription?.status ?? "not started")}</td><td>{affiliateStatusLabel(referral.status)}</td><td>{referral.successfulPaidPeriods}</td><td>{referral.eligibleCommissionPeriodsCompleted} / 12</td></tr>)}</tbody></table></div></section>
    <section className="panel"><p className="eyebrow">Immutable ledger</p><h2>Recent Stripe transactions</h2><div className="table-wrap"><table className="admin-table"><thead><tr><th>Supplier</th><th>Invoice</th><th>Type</th><th>Eligible revenue</th><th>Commission</th><th>Status</th></tr></thead><tbody>{affiliate.commissions.map((entry) => <tr key={entry.id}><td>{entry.supplierCompany.legalName}</td><td>{entry.stripeInvoiceId}</td><td>{affiliateStatusLabel(entry.entryType)}</td><td>{money(entry.eligibleRevenuePence, entry.currency)}</td><td>{money(entry.commissionAmountPence, entry.currency)}</td><td>{affiliateStatusLabel(entry.status)}</td></tr>)}</tbody></table></div></section>
    <section className="panel"><p className="eyebrow">Payout controls</p><h2>Statements</h2><p>Only commission that has passed the 30-day validation period is included.</p><AffiliatePayoutControls affiliateId={affiliate.id} scheduled={affiliate.payouts.filter((payout) => payout.status === "SCHEDULED").map((payout) => ({ id: payout.id, reference: payout.statementReference }))} /></section>
    <section className="panel"><p className="eyebrow">Audit history</p><h2>Important changes</h2>{affiliate.auditLogs.map((item) => <div className="data-row" key={item.id}><div><b>{item.summary}</b><small>{item.action}</small></div><time>{item.createdAt.toLocaleString("en-GB")}</time></div>)}</section>
  </>;
}
