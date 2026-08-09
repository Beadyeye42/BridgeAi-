import { prisma } from "@/lib/db";
import { requireAffiliatePage } from "@/lib/auth/guards";
import { affiliateStatusLabel, money } from "@/lib/affiliates/display";

export default async function AffiliateReferralsPage() {
  const { affiliate } = await requireAffiliatePage();
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const referrals = await prisma.affiliateReferral.findMany({
    where: { affiliateId: affiliate.id },
    include: { supplierCompany: { include: { subscription: { include: { membershipPlan: true } } } }, commissions: { where: { entryType: "INVOICE" }, orderBy: { earnedAt: "desc" } } },
    orderBy: { referredAt: "desc" },
  });
  return <><div className="page-heading"><div><p className="eyebrow">Attribution</p><h1>My referrals</h1><p>Permanent supplier attribution and their live Stripe subscription progress.</p></div></div><section className="panel"><div className="table-wrap"><table className="data-table"><thead><tr><th>Supplier</th><th>Signup</th><th>Plan</th><th>Subscription</th><th>Referral status</th><th>Commission progress</th><th>Earnings</th><th>Next billing / cancellation</th></tr></thead><tbody>{referrals.map((referral) => {
    const subscription = referral.supplierCompany.subscription;
    const valid = referral.commissions.filter((entry) => entry.status !== "REVERSED" && entry.status !== "NOT_ELIGIBLE");
    const thisMonth = valid.filter((entry) => entry.earnedAt >= monthStart).reduce((sum, entry) => sum + entry.commissionAmountPence, 0);
    const total = valid.reduce((sum, entry) => sum + entry.commissionAmountPence, 0);
    return <tr key={referral.id}><td>{referral.supplierCompany.legalName}</td><td>{(referral.signupAt ?? referral.referredAt).toLocaleDateString("en-GB")}</td><td>{subscription?.membershipPlan?.name ?? subscription?.planCode ?? "—"}</td><td>{affiliateStatusLabel(subscription?.status ?? "not started")}</td><td>{affiliateStatusLabel(referral.status)}</td><td>{referral.successfulPaidPeriods === 1 ? "Qualification month" : `${referral.eligibleCommissionPeriodsCompleted} of 12`}</td><td>{money(thisMonth)}<small>{money(total)} total</small></td><td>{referral.cancellationScheduledAt ? `Cancels ${referral.cancellationScheduledAt.toLocaleDateString("en-GB")}` : subscription?.currentPeriodEnd?.toLocaleDateString("en-GB") ?? "—"}</td></tr>;
  })}{!referrals.length && <tr><td colSpan={8}>No referred suppliers yet.</td></tr>}</tbody></table></div></section></>;
}
