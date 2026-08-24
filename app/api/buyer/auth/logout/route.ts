import { NextResponse } from "next/server";
import { runAsDatabaseWorker } from "@/lib/db";
import { getVerifiedAuthContext } from "@/lib/supabase/verified-user";
import { createClient } from "@/lib/supabase/auth-server";

export async function POST(request: Request) {
  const auth = await getVerifiedAuthContext();
  if (auth) {
    await runAsDatabaseWorker("buyer_auth", async (tx) => {
      const now = new Date();
      const revoked = await tx.buyerTrustedSession.updateMany({
        where: { sessionId: auth.sessionId, authUserId: auth.user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (revoked.count > 0) {
        const buyer = await tx.customerContact.findFirst({ where: { buyerAuthUserId: auth.user.id }, select: { id: true } });
        await tx.buyerSecurityEvent.create({
          data: { customerContactId: buyer?.id, authUserId: auth.user.id, eventType: "BUYER_TRUSTED_SESSION_REVOKED", metadata: { reason: "LOGOUT" } },
        });
      }
    }).catch(() => undefined);
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/buyer/login", request.url), { status: 303 });
}
