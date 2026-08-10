import { prisma } from "@/lib/db";
import { requireAffiliatePage } from "@/lib/auth/guards";
import { affiliateStatusLabel, money } from "@/lib/affiliates/display";
import { getCurrentAffiliateReferralSummaries } from "@/lib/affiliates/referral-summaries";

export default async function AffiliateReferralsPage() {
  const { affiliate } = await requireAffiliatePage();
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const { referrals, commissions } = await prisma.$transaction(async (tx) => ({
    referrals: await getCurrentAffiliateReferralSummaries(tx),
    commissions: await tx.affiliateCommission.findMany({
      where: { affiliateId: affiliate.id, entryType: "INVOICE" },
      select: { supplierCompanyId: true, status: true, earnedAt: true, commissionAmountPence: true },
      orderBy: { earnedAt: "desc" },
    }),
  }));
  const commissionsByCompany = Map.groupBy(commissions, (entry) => entry.supplierCompanyId);
  return <><div className="page-heading"><div><p className="eyebrow">Attribution</p><h1>My referrals</h1><p>Permanent supplier attribution and their live Stripe subscription progress.</p></div></div><section className="panel"><div className="table-wrap"><table className="data-table"><thead><tr><th>Supplier</th><th>Signup</th><th>Plan</th><th>Subscription</th><th>Referral status</th><th>Commission progress</th><th>Earnings</th><th>Next billing / cancellation</th></tr></thead><tbody>{referrals.map((referral) => {
    const valid = (commissionsByCompany.get(referral.supplierCompanyId) ?? []).filter((entry) => entry.status !== "REVERSED" && entry.status !== "NOT_ELIGIBLE");
    const thisMonth = valid.filter((entry) => entry.earnedAt >= monthStart).reduce((sum, entry) => sum + entry.commissionAmountPence, 0);
    const total = valid.reduce((sum, entry) => sum + entry.commissionAmountPence, 0);
    return <tr key={referral.referralId}><td>{referral.supplierName}</td><td>{(referral.signupAt ?? referral.referredAt).toLocaleDateString("en-GB")}</td><td>{referral.planName ?? referral.planCode ?? "—"}</td><td>{affiliateStatusLabel(referral.subscriptionStatus ?? "not started")}</td><td>{affiliateStatusLabel(referral.referralStatus)}</td><td>{referral.successfulPaidPeriods === 1 ? "Qualification month" : `${referral.eligibleCommissionPeriodsCompleted} of 12`}</td><td>{money(thisMonth)}<small>{money(total)} total</small></td><td>{referral.cancellationScheduledAt ? `Cancels ${referral.cancellationScheduledAt.toLocaleDateString("en-GB")}` : referral.currentPeriodEnd?.toLocaleDateString("en-GB") ?? "—"}</td></tr>;
  })}{!referrals.length && <tr><td colSpan={8}>No referred suppliers yet.</td></tr>}</tbody></table></div></section></>;
}
