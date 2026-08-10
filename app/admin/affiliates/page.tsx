import Link from "next/link";
import { CircleAlert, UsersRound } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { AffiliateCreateForm, AffiliateStatusControl } from "@/components/admin/affiliate-manager";
import { affiliateStatusLabel, money } from "@/lib/affiliates/display";

type AffiliateMetric = {
  referrals: number;
  activePaid: number;
  qualifying: number;
  earning: number;
  lost: number;
  currentMonthPence: number;
  lifetimePence: number;
};

function emptyMetric(): AffiliateMetric {
  return { referrals: 0, activePaid: 0, qualifying: 0, earning: 0, lost: 0, currentMonthPence: 0, lifetimePence: 0 };
}

export default async function AdminAffiliatesPage() {
  await requireAdminPage();
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const snapshot = await prisma.$transaction(async (tx) => {
    const programme = await tx.affiliateProgramme.findUniqueOrThrow({ where: { id: "default" } });
    const affiliates = await tx.affiliate.findMany({
      include: { user: true, _count: { select: { clicks: true, referrals: true } } },
      orderBy: { createdAt: "desc" },
    });
    const referrals = await tx.affiliateReferral.findMany({
      select: {
        affiliateId: true,
        status: true,
        cancelledAt: true,
        supplierCompany: { select: { subscription: { select: { status: true, accessSource: true } } } },
      },
    });
    const ledgerTotals = await tx.affiliateCommission.groupBy({
      by: ["affiliateId"],
      where: { status: { notIn: ["REVERSED", "NOT_ELIGIBLE"] } },
      _sum: { eligibleRevenuePence: true, commissionAmountPence: true },
    });
    const monthTotals = await tx.affiliateCommission.groupBy({
      by: ["affiliateId"],
      where: { earnedAt: { gte: monthStart }, status: { notIn: ["REVERSED", "NOT_ELIGIBLE"] } },
      _sum: { commissionAmountPence: true },
    });
    const cancellations = await tx.affiliateReferral.findMany({
      where: { OR: [{ cancelledAt: { not: null } }, { cancellationScheduledAt: { not: null } }] },
      include: {
        affiliate: { select: { id: true, displayName: true } },
        supplierCompany: { select: { legalName: true, subscription: { select: { currentPeriodEnd: true } } } },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    });
    return { programme, affiliates, referrals, ledgerTotals, monthTotals, cancellations };
  });

  const metrics = new Map(snapshot.affiliates.map((affiliate) => [affiliate.id, emptyMetric()]));
  for (const referral of snapshot.referrals) {
    const metric = metrics.get(referral.affiliateId);
    if (!metric) continue;
    metric.referrals += 1;
    if (referral.supplierCompany.subscription?.status === "ACTIVE" && referral.supplierCompany.subscription.accessSource === "STRIPE") metric.activePaid += 1;
    if (referral.status === "QUALIFICATION_MONTH") metric.qualifying += 1;
    if (referral.status === "COMMISSION_ACTIVE") metric.earning += 1;
    if (referral.status === "CANCELLED") metric.lost += 1;
  }
  for (const total of snapshot.ledgerTotals) {
    const metric = metrics.get(total.affiliateId);
    if (metric) metric.lifetimePence = total._sum.commissionAmountPence ?? 0;
  }
  for (const total of snapshot.monthTotals) {
    const metric = metrics.get(total.affiliateId);
    if (metric) metric.currentMonthPence = total._sum.commissionAmountPence ?? 0;
  }
  const activeCount = snapshot.affiliates.filter((affiliate) => affiliate.status === "ACTIVE").length;
  const referredRevenue = snapshot.ledgerTotals.reduce((sum, total) => sum + (total._sum.eligibleRevenuePence ?? 0), 0);
  const netCommission = snapshot.ledgerTotals.reduce((sum, total) => sum + (total._sum.commissionAmountPence ?? 0), 0);
  const currentMonthCommission = snapshot.monthTotals.reduce((sum, total) => sum + (total._sum.commissionAmountPence ?? 0), 0);
  const activePaidSubscribers = [...metrics.values()].reduce((sum, metric) => sum + metric.activePaid, 0);

  return <>
    <AdminHeading eyebrow={`${activeCount} of ${snapshot.programme.maximumActive} active places used`} title="Affiliates" description="Every figure comes from permanent referral attribution and individual Stripe invoice ledger records." />
    <section className="admin-affiliate-circle"><div><p className="eyebrow"><UsersRound size={14} /> Limited partner circle</p><h2>{snapshot.programme.maximumActive - activeCount} affiliate place{snapshot.programme.maximumActive - activeCount === 1 ? "" : "s"} remaining</h2><p>Bridge AI will never activate more than {snapshot.programme.maximumActive} affiliates without changing the programme control deliberately.</p></div><strong>{activeCount}<span> / {snapshot.programme.maximumActive}</span></strong></section>
    <div className="stats-grid">
      <article className="stat-card"><span>Active paid subscribers</span><strong>{activePaidSubscribers}</strong><small>Across all affiliates</small></article>
      <article className="stat-card"><span>This month&apos;s commission</span><strong>{money(currentMonthCommission)}</strong><small>Net invoice ledger movement</small></article>
      <article className="stat-card"><span>Referred subscription revenue</span><strong>{money(referredRevenue)}</strong><small>Eligible revenue, excluding VAT</small></article>
      <article className="stat-card"><span>Lifetime net commissions</span><strong>{money(netCommission)}</strong><small>Includes refunds and disputes</small></article>
    </div>
    {snapshot.cancellations.length > 0 && <section className="panel affiliate-cancellation-panel"><div className="panel-heading"><div><p className="eyebrow"><CircleAlert size={14} /> Business notifications</p><h2>Recent referral cancellations</h2></div><span>{snapshot.cancellations.length} recent</span></div><div className="data-list">{snapshot.cancellations.map((referral) => <div className="data-row" key={referral.id}><div><b>{referral.supplierCompany.legalName}</b><small>Affiliate: {referral.affiliate.displayName}</small></div><div><b>{affiliateStatusLabel(referral.status)}</b><small>{referral.cancelledAt ? `Ended ${referral.cancelledAt.toLocaleDateString("en-GB")}` : referral.supplierCompany.subscription?.currentPeriodEnd ? `Access ends ${referral.supplierCompany.subscription.currentPeriodEnd.toLocaleDateString("en-GB")}` : "Cancellation scheduled"}</small></div><Link href={`/admin/affiliates/${referral.affiliate.id}`}>Review</Link></div>)}</div></section>}
    <section className="panel admin-affiliate-invite"><div className="admin-affiliate-invite-copy"><p className="eyebrow">Administrator-only control</p><h2>Invite an approved affiliate</h2><p>Create a private affiliate account only after you have approved the person or business. They will receive their own separate portal and will never see this administrator console.</p><div className="admin-access-note"><b>Who can use this?</b><span>Only an active Bridge AI platform administrator. Suppliers, affiliates and customers are blocked.</span></div></div><div className="admin-affiliate-invite-form"><AffiliateCreateForm /></div></section>
    <section className="panel admin-affiliate-table-panel"><div className="panel-heading"><div><p className="eyebrow">Commercial oversight</p><h2>Affiliate subscribers and earnings</h2></div></div><div className="table-wrap"><table className="admin-table affiliate-admin-table"><thead><tr><th>Affiliate</th><th>Active paid</th><th>Qualifying / earning</th><th>Total referrals</th><th>This month</th><th>Lifetime net</th><th>Lost</th><th>Status</th></tr></thead><tbody>{snapshot.affiliates.map((affiliate) => {
        const metric = metrics.get(affiliate.id) ?? emptyMetric();
        return <tr key={affiliate.id}><td><Link href={`/admin/affiliates/${affiliate.id}`}><b>{affiliate.displayName}</b><small>{affiliate.code} · {affiliate._count.clicks} clicks</small></Link></td><td><b>{metric.activePaid}</b><small>Stripe active</small></td><td>{metric.qualifying} / {metric.earning}</td><td>{metric.referrals}</td><td>{money(metric.currentMonthPence)}</td><td><b>{money(metric.lifetimePence)}</b></td><td>{metric.lost}</td><td><AffiliateStatusControl id={affiliate.id} status={affiliate.status} /></td></tr>;
      })}{!snapshot.affiliates.length && <tr><td colSpan={8}>No affiliates have been created yet. The first approved partner will hold one of ten limited places.</td></tr>}</tbody></table></div></section>
  </>;
}
