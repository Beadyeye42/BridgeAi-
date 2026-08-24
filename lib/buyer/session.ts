import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { runAsDatabaseWorker } from "@/lib/db";
import { getVerifiedAuthContext } from "@/lib/supabase/verified-user";

export const getBuyerSession = cache(async () => {
  const auth = await getVerifiedAuthContext();
  if (!auth) return null;
  const now = new Date();
  const resolved = await runAsDatabaseWorker("buyer_auth", async (tx) => {
    const trustedSession = await tx.buyerTrustedSession.findFirst({
      where: {
        sessionId: auth.sessionId,
        authUserId: auth.user.id,
        revokedAt: null,
        expiresAt: { gt: now },
        customerContact: { buyerPortalStatus: "ACTIVE", buyerAuthUserId: auth.user.id },
      },
      select: {
        id: true,
        lastSeenAt: true,
        customerContact: {
          select: {
            id: true,
            buyerAuthUserId: true,
            preferredFirstNameEncrypted: true,
            displayNameEncrypted: true,
            companyNameEncrypted: true,
            defaultPostcodeEncrypted: true,
            buyerTypePreference: true,
            buyerWhatsAppUpdates: true,
            buyerEmailUpdates: true,
            buyerLastLoginAt: true,
          },
        },
      },
    });
    if (!trustedSession) return null;
    if (trustedSession.lastSeenAt.getTime() < now.getTime() - 60 * 60 * 1_000) {
      await tx.buyerTrustedSession.update({ where: { id: trustedSession.id }, data: { lastSeenAt: now } });
    }
    return trustedSession.customerContact;
  });
  if (!resolved) return null;
  return { user: auth.user, sessionId: auth.sessionId, buyer: resolved };
});

export async function requireBuyerSession(next = "/buyer") {
  const session = await getBuyerSession();
  if (!session) redirect(`/buyer/login?next=${encodeURIComponent(next)}`);
  return session;
}
