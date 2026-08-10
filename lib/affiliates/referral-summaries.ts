import type { Prisma } from "@prisma/client";

export type AffiliateReferralSummary = {
  referralId: string;
  supplierCompanyId: string;
  supplierName: string;
  referralStatus: string;
  referredAt: Date;
  signupAt: Date | null;
  successfulPaidPeriods: number;
  eligibleCommissionPeriodsCompleted: number;
  cancellationScheduledAt: Date | null;
  cancelledAt: Date | null;
  subscriptionStatus: string | null;
  subscriptionAccessSource: string | null;
  planCode: string | null;
  planName: string | null;
  currentPeriodEnd: Date | null;
};

/**
 * Returns the deliberately limited supplier details an affiliate needs to
 * understand their own referrals. The database function derives the affiliate
 * from the verified request identity; callers cannot request another
 * affiliate's data or read supplier contact/profile fields.
 */
export function getCurrentAffiliateReferralSummaries(tx: Prisma.TransactionClient) {
  return tx.$queryRaw<AffiliateReferralSummary[]>`
    SELECT * FROM bridge_private.current_affiliate_referral_summaries()
  `;
}
