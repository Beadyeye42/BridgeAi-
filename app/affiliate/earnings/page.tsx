import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAffiliatePage } from "@/lib/auth/guards";
import { affiliateStatusLabel, money } from "@/lib/affiliates/display";
import { getCurrentAffiliateReferralSummaries } from "@/lib/affiliates/referral-summaries";

const LEDGER_STATUSES = ["QUALIFICATION","PENDING","AVAILABLE","SCHEDULED","PAID","REVERSED","NOT_ELIGIBLE","ADJUSTMENT_PENDING","ADJUSTMENT_APPLIED"] as const;

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function displayDate(date: Date | null | undefined) { return date?.toLocaleDateString("en-GB") ?? "—"; }

export default async function AffiliateEarningsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; supplier?: string; plan?: string; status?: string }> }) {
  const { affiliate } = await requireAffiliatePage();
  const filters = await searchParams;
  const from = filters.from && !Number.isNaN(Date.parse(filters.from)) ? new Date(`${filters.from}T00:00:00.000Z`) : undefined;
  const to = filters.to && !Number.isNaN(Date.parse(filters.to)) ? new Date(`${filters.to}T23:59:59.999Z`) : undefined;
  const status = LEDGER_STATUSES.includes(filters.status as (typeof LEDGER_STATUSES)[number]) ? filters.status : undefined;
  const { entries, summaries, plans } = await prisma.$transaction(async (tx) => ({
    entries: await tx.affiliateCommission.findMany({
      where: {
        affiliateId: affiliate.id,
        supplierCompanyId: filters.supplier || undefined,
        membershipPlanId: filters.plan || undefined,
        status: status as never,
        earnedAt: from || to ? { gte: from, lte: to } : undefined,
      },
      include: { membershipPlan: { select: { name: true } }, payoutItem: { include: { payout: { select: { paidAt: true, statementReference: true } } } } },
      orderBy: { earnedAt: "desc" },
    }),
    summaries: await getCurrentAffiliateReferralSummaries(tx),
    plans: await tx.membershipPlan.findMany({ where: { affiliateCommissions: { some: { affiliateId: affiliate.id } } }, select: { id: true, name: true }, orderBy: { monthlyPricePence: "asc" } }),
  }));
  const suppliers = summaries.toSorted((left, right) => left.supplierName.localeCompare(right.supplierName));
  const supplierNames = new Map(summaries.map((item) => [item.supplierCompanyId, item.supplierName]));
  const currentMonth = new Date(); currentMonth.setUTCDate(1); currentMonth.setUTCHours(0, 0, 0, 0);
  const nextMonth = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 1));
  const previousMonth = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - 1, 1));
  return <><div className="page-heading"><div><p className="eyebrow">Accounting ledger</p><h1>Earnings</h1><p>Every row is tied to one verified Stripe invoice, refund or dispute.</p></div></div>
    <div className="affiliate-quick-filters"><Link href={`/affiliate/earnings?from=${isoDate(currentMonth)}&to=${isoDate(new Date(nextMonth.getTime() - 1))}`}>Current month</Link><Link href={`/affiliate/earnings?from=${isoDate(previousMonth)}&to=${isoDate(new Date(currentMonth.getTime() - 1))}`}>Previous month</Link><Link href="/affiliate/earnings">All time</Link></div>
    <form className="panel filter-bar"><label>From<input type="date" name="from" defaultValue={filters.from} /></label><label>To<input type="date" name="to" defaultValue={filters.to} /></label><label>Supplier<select name="supplier" defaultValue={filters.supplier ?? ""}><option value="">All suppliers</option>{suppliers.map((item) => <option key={item.supplierCompanyId} value={item.supplierCompanyId}>{item.supplierName}</option>)}</select></label><label>Plan<select name="plan" defaultValue={filters.plan ?? ""}><option value="">All plans</option>{plans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name}</option>)}</select></label><label>Status<select name="status" defaultValue={status ?? ""}><option value="">All statuses</option>{LEDGER_STATUSES.map((item) => <option value={item} key={item}>{affiliateStatusLabel(item)}</option>)}</select></label><button className="button-primary">Apply filters</button></form>
    <section className="panel"><div className="table-wrap"><table className="data-table affiliate-ledger-table"><thead><tr><th>Supplier / plan</th><th>Paid / eligible ex VAT</th><th>Billing period</th><th>Commission month</th><th>Rate / commission</th><th>Status</th><th>Stripe invoice</th><th>Ledger dates</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{supplierNames.get(entry.supplierCompanyId) ?? "Referred supplier"}<small>{entry.membershipPlan?.name ?? entry.planCode}</small></td><td>{money(entry.billingAmountPence, entry.currency)}<small>{money(entry.eligibleRevenuePence, entry.currency)} eligible</small></td><td>{displayDate(entry.billingPeriodStart)}<small>to {displayDate(entry.billingPeriodEnd)}</small></td><td>{entry.commissionSequence === 0 ? "Qualification" : entry.commissionSequence ? `${entry.commissionSequence} of 12` : "Completed / ineligible"}</td><td>{(entry.commissionRateBps / 100).toFixed(2)}%<small>{money(entry.commissionAmountPence, entry.currency)}</small></td><td>{affiliateStatusLabel(entry.status)}</td><td><span title={entry.stripeInvoiceId}>{entry.stripeInvoiceId}</span><small>{entry.payoutItem?.payout.statementReference ?? "Not in statement"}</small></td><td>Earned {displayDate(entry.earnedAt)}<small>Valid {displayDate(entry.validatedAt ?? entry.validationAt)} · Paid {displayDate(entry.paidAt ?? entry.payoutItem?.payout.paidAt)}</small></td></tr>)}{!entries.length && <tr><td colSpan={8}>No ledger transactions match these filters.</td></tr>}</tbody></table></div></section>
  </>;
}
