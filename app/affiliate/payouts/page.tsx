import { prisma } from "@/lib/db";
import { requireAffiliatePage } from "@/lib/auth/guards";
import { affiliateStatusLabel, money } from "@/lib/affiliates/display";

export default async function AffiliatePayoutsPage() {
  const { affiliate } = await requireAffiliatePage();
  const payouts = await prisma.affiliatePayout.findMany({ where: { affiliateId: affiliate.id }, include: { items: true }, orderBy: { periodEnd: "desc" } });
  return <><div className="page-heading"><div><p className="eyebrow">Statements</p><h1>Payout history</h1><p>Monthly statements preserve commissions, reversals and adjustments.</p></div></div><section className="panel"><div className="table-wrap"><table className="data-table"><thead><tr><th>Statement</th><th>Period</th><th>Earned</th><th>Reversals</th><th>Paid</th><th>Closing balance</th><th>Status</th></tr></thead><tbody>{payouts.map((payout) => <tr key={payout.id}><td>{payout.statementReference}</td><td>{payout.periodStart.toLocaleDateString("en-GB")} – {payout.periodEnd.toLocaleDateString("en-GB")}</td><td>{money(payout.commissionsEarnedPence)}</td><td>{money(payout.reversalsPence)}</td><td>{money(payout.amountPaidPence)}</td><td>{money(payout.closingBalancePence)}</td><td>{affiliateStatusLabel(payout.status)}</td></tr>)}{!payouts.length && <tr><td colSpan={7}>No payout statements yet. Commission becomes available after the 30-day validation period.</td></tr>}</tbody></table></div></section></>;
}
