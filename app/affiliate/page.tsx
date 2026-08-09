import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAffiliatePage } from "@/lib/auth/guards";
import { affiliateStatusLabel, money } from "@/lib/affiliates/display";

const RANGE_OPTIONS = [1, 3, 6, 12] as const;

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
  // Prisma requests stay sequential because each RLS-scoped transaction uses the
  // deliberately small production pool. Fan-out here could starve webhook work.
  const referrals = await prisma.affiliateReferral.findMany({ where: { affiliateId: affiliate.id }, include: { supplierCompany: { include: { subscription: { include: { membershipPlan: true } } } } }, orderBy: { referredAt: "desc" }, take: 8 });
  const commissions = await prisma.affiliateCommission.findMany({ where: { affiliateId: affiliate.id }, orderBy: { earnedAt: "desc" } });
  const clicks = await prisma.referralClick.count({ where: { affiliateId: affiliate.id } });
  const payouts = await prisma.affiliatePayout.aggregate({ where: { affiliateId: affiliate.id, status: "PAID" }, _sum: { amountPaidPence: true } });
  const notices = await prisma.affiliateNotification.findMany({ where: { affiliateId: affiliate.id, readAt: null }, orderBy: { createdAt: "desc" }, take: 4 });
  const included = commissions.filter((entry) => entry.status !== "REVERSED" && entry.status !== "NOT_ELIGIBLE");
  const thisMonth = included.filter((entry) => entry.earnedAt >= monthStart).reduce((sum, entry) => sum + entry.commissionAmountPence, 0);
  const pending = included.filter((entry) => ["PENDING", "ADJUSTMENT_PENDING"].includes(entry.status)).reduce((sum, entry) => sum + entry.commissionAmountPence, 0);
  const available = included.filter((entry) => entry.status === "AVAILABLE").reduce((sum, entry) => sum + entry.commissionAmountPence, 0);
  const active = referrals.filter((referral) => referral.supplierCompany.subscription?.status === "ACTIVE").length;
  const qualifying = referrals.filter((referral) => referral.status === "QUALIFICATION_MONTH").length;
  const earning = referrals.filter((referral) => referral.status === "COMMISSION_ACTIVE").length;
  const lostThisMonth = referrals.filter((referral) => Boolean(referral.cancelledAt && referral.cancelledAt >= monthStart)).length;
  const lifetime = included.reduce((sum, entry) => sum + entry.commissionAmountPence, 0);
  const eligibleRevenue = included.reduce((sum, entry) => sum + entry.eligibleRevenuePence, 0);
  const paid = payouts._sum.amountPaidPence ?? 0;
  const chartMonths = Array.from({ length: months }, (_, index) => new Date(Date.UTC(chartStart.getUTCFullYear(), chartStart.getUTCMonth() + index, 1)));
  const monthlyEarnings = new Map(chartMonths.map((date) => [monthKey(date), 0]));
  for (const entry of included) {
    const key = monthKey(entry.earnedAt);
    if (monthlyEarnings.has(key)) monthlyEarnings.set(key, (monthlyEarnings.get(key) ?? 0) + entry.commissionAmountPence);
  }
  const chart = chartMonths.map((date) => ({ key: monthKey(date), label: monthLabel(date), amount: monthlyEarnings.get(monthKey(date)) ?? 0 }));
  const chartMaximum = Math.max(1, ...chart.map((item) => Math.abs(item.amount)));
  return <>
    <div className="page-heading"><div><p className="eyebrow">Affiliate programme</p><h1>Your earnings dashboard</h1><p>Live, invoice-backed referral and commission figures.</p></div></div>
    <div className="stats-grid">
      <article className="stat-card affiliate-stat"><div><p>Active suppliers</p><b>{active}</b><span>Currently paying referrals</span></div></article>
      <article className="stat-card affiliate-stat"><div><p>Qualifying suppliers</p><b>{qualifying}</b><span>First paid month earns £0</span></div></article>
      <article className="stat-card affiliate-stat"><div><p>This month&apos;s earnings</p><b>{money(thisMonth)}</b><span>Successful Stripe invoices only</span></div></article>
      <article className="stat-card affiliate-stat"><div><p>Available balance</p><b>{money(available)}</b><span>{money(payouts._sum.amountPaidPence ?? 0)} paid to date</span></div></article>
    </div>
    <section className="panel affiliate-chart-panel">
      <div className="panel-heading"><div><p className="eyebrow">Invoice ledger</p><h2>Monthly earnings</h2></div><nav className="affiliate-range" aria-label="Earnings chart range">{RANGE_OPTIONS.map((range) => <Link className={range === months ? "is-active" : ""} href={`/affiliate?months=${range}`} key={range}>{range === 1 ? "Current month" : `${range} months`}</Link>)}</nav></div>
      <div className="affiliate-chart" style={{ gridTemplateColumns: `repeat(${months}, minmax(54px, 1fr))` }} role="img" aria-label={`Net affiliate commission recorded over the last ${months} months`}>
        {chart.map((item) => <div className="affiliate-chart-column" key={item.key}><b>{money(item.amount)}</b><div className="affiliate-chart-track"><i className={item.amount < 0 ? "is-negative" : ""} style={{ height: `${Math.max(item.amount === 0 ? 2 : 8, Math.round(Math.abs(item.amount) / chartMaximum * 100))}%` }} /></div><span>{item.label}</span></div>)}
      </div>
      <p className="affiliate-chart-note">Calculated from individual paid-invoice ledger entries and refund or dispute adjustments—not from a customer-count estimate.</p>
    </section>
    <section className="panel affiliate-metrics-panel"><div className="panel-heading"><div><p className="eyebrow">Financial position</p><h2>Programme metrics</h2></div><Link href="/affiliate/earnings">Inspect ledger</Link></div><dl className="affiliate-metrics-grid"><div><dt>Commission-earning suppliers</dt><dd>{earning}</dd></div><div><dt>Pending earnings</dt><dd>{money(pending)}</dd></div><div><dt>Total paid</dt><dd>{money(paid)}</dd></div><div><dt>Lifetime earnings</dt><dd>{money(lifetime)}</dd></div><div><dt>Lost suppliers this month</dt><dd>{lostThisMonth}</dd></div><div><dt>Eligible subscription revenue</dt><dd>{money(eligibleRevenue)}</dd></div></dl></section>
    <div className="dashboard-grid"><section className="panel panel-wide"><div className="panel-heading"><div><p className="eyebrow">Recent referrals</p><h2>Supplier progress</h2></div><Link href="/affiliate/referrals">View all</Link></div>
      <div className="data-list">{referrals.length ? referrals.map((referral) => <div className="data-row" key={referral.id}><div><b>{referral.supplierCompany.legalName}</b><small>{referral.supplierCompany.subscription?.membershipPlan?.name ?? "No paid plan yet"}</small></div><div><b>{affiliateStatusLabel(referral.status)}</b><small>{referral.eligibleCommissionPeriodsCompleted} of 12 commission months</small></div></div>) : <div className="empty-state">No referred suppliers yet.</div>}</div>
    </section><aside className="panel"><p className="eyebrow">Your referral link</p><h2>Share Bridge AI</h2><p className="mono-field">{`${process.env.APP_URL ?? "https://bridge-ai-sable.vercel.app"}/join?ref=${affiliate.code}`}</p><p><b>{clicks}</b> recorded referral-link clicks</p></aside></div>
    {notices.length > 0 && <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Updates</p><h2>Needs your attention</h2></div><Link href="/affiliate/notifications">All notifications</Link></div>{notices.map((notice) => <div className="data-row" key={notice.id}><div><b>{notice.title}</b><small>{notice.body}</small></div></div>)}</section>}
  </>;
}
