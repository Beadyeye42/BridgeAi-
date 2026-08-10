import Link from "next/link";
import { BadgeCheck, LockKeyhole, Sparkles } from "lucide-react";
import type { AffiliateCommissionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAffiliatePage } from "@/lib/auth/guards";
import { affiliateStatusLabel, money } from "@/lib/affiliates/display";
import { getCurrentAffiliateReferralSummaries } from "@/lib/affiliates/referral-summaries";

const RANGE_OPTIONS = [1, 3, 6, 12] as const;
const INCLUDED_LEDGER_STATUSES = { notIn: ["REVERSED", "NOT_ELIGIBLE"] as AffiliateCommissionStatus[] };

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date: Date) {
  return date.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export default async function AffiliateDashboardPage({ searchParams }: { searchParams: Promise<{ months?: string }> }) {
  const { affiliate } = await requireAffiliatePage();
  const requestedMonths = Number((await searchParams).months);
  const months = RANGE_OPTIONS.includes(requestedMonths as (typeof RANGE_OPTIONS)[number]) ? requestedMonths : 6;
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const chartStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - months + 1, 1));

  // One RLS-scoped transaction keeps the affiliate snapshot internally consistent
  // without competing with Stripe and WhatsApp work for the deliberately small pool.
  const snapshot = await prisma.$transaction(async (tx) => {
    const programme = await tx.affiliateProgramme.findUniqueOrThrow({ where: { id: "default" } });
    const referralSummaries = await getCurrentAffiliateReferralSummaries(tx);
    const referrals = referralSummaries.slice(0, 8);
    const chartEntries = await tx.affiliateCommission.findMany({
      where: { affiliateId: affiliate.id, earnedAt: { gte: chartStart }, status: INCLUDED_LEDGER_STATUSES },
      select: { earnedAt: true, commissionAmountPence: true },
      orderBy: { earnedAt: "asc" },
    });
    const clicks = await tx.referralClick.count({ where: { affiliateId: affiliate.id } });
    const payouts = await tx.affiliatePayout.aggregate({ where: { affiliateId: affiliate.id, status: "PAID" }, _sum: { amountPaidPence: true } });
    const notices = await tx.affiliateNotification.findMany({ where: { affiliateId: affiliate.id, readAt: null }, orderBy: { createdAt: "desc" }, take: 4 });
    const active = referralSummaries.filter((referral) => referral.subscriptionStatus === "ACTIVE" && referral.subscriptionAccessSource === "STRIPE").length;
    const qualifying = await tx.affiliateReferral.count({ where: { affiliateId: affiliate.id, status: "QUALIFICATION_MONTH" } });
    const earning = await tx.affiliateReferral.count({ where: { affiliateId: affiliate.id, status: "COMMISSION_ACTIVE" } });
    const lostThisMonth = await tx.affiliateReferral.count({ where: { affiliateId: affiliate.id, cancelledAt: { gte: monthStart } } });
    const thisMonth = await tx.affiliateCommission.aggregate({ where: { affiliateId: affiliate.id, earnedAt: { gte: monthStart }, status: INCLUDED_LEDGER_STATUSES }, _sum: { commissionAmountPence: true } });
    const pending = await tx.affiliateCommission.aggregate({ where: { affiliateId: affiliate.id, status: { in: ["PENDING", "ADJUSTMENT_PENDING"] } }, _sum: { commissionAmountPence: true } });
    const available = await tx.affiliateCommission.aggregate({ where: { affiliateId: affiliate.id, status: "AVAILABLE" }, _sum: { commissionAmountPence: true } });
    const lifetime = await tx.affiliateCommission.aggregate({ where: { affiliateId: affiliate.id, status: INCLUDED_LEDGER_STATUSES }, _sum: { commissionAmountPence: true, eligibleRevenuePence: true } });
    return { programme, referrals, chartEntries, clicks, payouts, notices, active, qualifying, earning, lostThisMonth, thisMonth, pending, available, lifetime };
  });

  const chartMonths = Array.from({ length: months }, (_, index) => new Date(Date.UTC(chartStart.getUTCFullYear(), chartStart.getUTCMonth() + index, 1)));
  const monthlyEarnings = new Map(chartMonths.map((date) => [monthKey(date), 0]));
  for (const entry of snapshot.chartEntries) {
    const key = monthKey(entry.earnedAt);
    if (monthlyEarnings.has(key)) monthlyEarnings.set(key, (monthlyEarnings.get(key) ?? 0) + entry.commissionAmountPence);
  }
  const chart = chartMonths.map((date) => ({ key: monthKey(date), label: monthLabel(date), amount: monthlyEarnings.get(monthKey(date)) ?? 0 }));
  const chartMaximum = Math.max(1, ...chart.map((item) => Math.abs(item.amount)));
  const commissionRate = (affiliate.commissionRateBps ?? snapshot.programme.commissionRateBps) / 100;
  const paid = snapshot.payouts._sum.amountPaidPence ?? 0;

  return <>
    <section className="affiliate-circle-hero">
      <div className="affiliate-circle-copy"><p className="eyebrow"><Sparkles size={14} /> Founding affiliate circle</p><h1>You hold one of only {snapshot.programme.maximumActive} approved places.</h1><p>Your private dashboard follows every referred supplier from signup to each successful Stripe invoice, so the figures below are always evidence-backed.</p><div className="affiliate-circle-trust"><span><BadgeCheck size={16} /> Place secured</span><span><LockKeyhole size={16} /> Permanent attribution</span></div></div>
      <div className="affiliate-circle-rate"><span>Your commission rate</span><strong>{commissionRate.toFixed(0)}%</strong><small>on eligible subscription revenue for 12 paid commission months</small></div>
    </section>
    <div className="page-heading"><div><p className="eyebrow">Affiliate programme</p><h1>Your earnings dashboard</h1><p>Live, invoice-backed referral and commission figures.</p></div></div>
    <div className="stats-grid">
      <article className="stat-card affiliate-stat"><div><p>Active paid suppliers</p><b>{snapshot.active}</b><span>All current Stripe subscribers under your wing</span></div></article>
      <article className="stat-card affiliate-stat"><div><p>Qualifying suppliers</p><b>{snapshot.qualifying}</b><span>First paid month earns £0</span></div></article>
      <article className="stat-card affiliate-stat"><div><p>This month&apos;s earnings</p><b>{money(snapshot.thisMonth._sum?.commissionAmountPence ?? 0)}</b><span>Successful Stripe invoices only</span></div></article>
      <article className="stat-card affiliate-stat"><div><p>Available balance</p><b>{money(snapshot.available._sum.commissionAmountPence ?? 0)}</b><span>{money(paid)} paid to date</span></div></article>
    </div>
    <section className="panel affiliate-chart-panel">
      <div className="panel-heading"><div><p className="eyebrow">Invoice ledger</p><h2>Monthly earnings</h2></div><nav className="affiliate-range" aria-label="Earnings chart range">{RANGE_OPTIONS.map((range) => <Link className={range === months ? "is-active" : ""} href={`/affiliate?months=${range}`} key={range}>{range === 1 ? "Current month" : `${range} months`}</Link>)}</nav></div>
      <div className="affiliate-chart" style={{ gridTemplateColumns: `repeat(${months}, minmax(54px, 1fr))` }} role="img" aria-label={`Net affiliate commission recorded over the last ${months} months`}>
        {chart.map((item) => <div className="affiliate-chart-column" key={item.key}><b>{money(item.amount)}</b><div className="affiliate-chart-track"><i className={item.amount < 0 ? "is-negative" : ""} style={{ height: `${Math.max(item.amount === 0 ? 2 : 8, Math.round(Math.abs(item.amount) / chartMaximum * 100))}%` }} /></div><span>{item.label}</span></div>)}
      </div>
      <p className="affiliate-chart-note">Calculated from individual paid-invoice ledger entries and refund or dispute adjustments—not from a customer-count estimate.</p>
    </section>
    <section className="panel affiliate-metrics-panel"><div className="panel-heading"><div><p className="eyebrow">Financial position</p><h2>Programme metrics</h2></div><Link href="/affiliate/earnings">Inspect ledger</Link></div><dl className="affiliate-metrics-grid"><div><dt>Commission-earning suppliers</dt><dd>{snapshot.earning}</dd></div><div><dt>Pending earnings</dt><dd>{money(snapshot.pending._sum?.commissionAmountPence ?? 0)}</dd></div><div><dt>Total paid</dt><dd>{money(paid)}</dd></div><div><dt>Lifetime earnings</dt><dd>{money(snapshot.lifetime._sum?.commissionAmountPence ?? 0)}</dd></div><div><dt>Lost suppliers this month</dt><dd>{snapshot.lostThisMonth}</dd></div><div><dt>Eligible subscription revenue</dt><dd>{money(snapshot.lifetime._sum?.eligibleRevenuePence ?? 0)}</dd></div></dl></section>
    <div className="dashboard-grid"><section className="panel panel-wide"><div className="panel-heading"><div><p className="eyebrow">Recent referrals</p><h2>Supplier progress</h2></div><Link href="/affiliate/referrals">View all</Link></div>
      <div className="data-list">{snapshot.referrals.length ? snapshot.referrals.map((referral) => <div className="data-row" key={referral.referralId}><div><b>{referral.supplierName}</b><small>{referral.planName ?? referral.planCode ?? "No paid plan yet"}</small></div><div><b>{affiliateStatusLabel(referral.referralStatus)}</b><small>{referral.eligibleCommissionPeriodsCompleted} of 12 commission months</small></div></div>) : <div className="empty-state">No referred suppliers yet. Your private referral link is ready whenever you are.</div>}</div>
    </section><aside className="panel affiliate-share-panel"><p className="eyebrow">Your referral link</p><h2>Grow your circle</h2><p className="mono-field">{`${process.env.APP_URL ?? "https://bridge-ai-sable.vercel.app"}/join?ref=${affiliate.code}`}</p><p><b>{snapshot.clicks}</b> recorded referral-link clicks</p><small>Every valid signup is permanently attributed to you before subscription billing begins.</small></aside></div>
    {snapshot.notices.length > 0 && <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Updates</p><h2>Needs your attention</h2></div><Link href="/affiliate/notifications">All notifications</Link></div>{snapshot.notices.map((notice) => <div className="data-row" key={notice.id}><div><b>{notice.title}</b><small>{notice.body}</small></div></div>)}</section>}
  </>;
}
