import { NextResponse } from "next/server";
import { z } from "zod";
import { completeBuyerLogin, recordBuyerLoginVerificationFailure } from "@/lib/buyer/auth";
import { createClient } from "@/lib/supabase/auth-server";

const bodySchema = z.object({
  challenge: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/),
  tokenHash: z.string().min(20).max(512),
  type: z.literal("magiclink"),
});

const invalidResponse = () => NextResponse.json(
  { error: "This sign-in link is invalid or has expired." },
  { status: 400, headers: { "cache-control": "private, no-store" } },
);

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_048) return invalidResponse();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidResponse();

  const supabase = await createClient();
  let authUserId: string | undefined;
  let stage = "SUPABASE_VERIFY";
  try {
    // Supabase is the credential authority. Only after it verifies the
    // one-time token do we consume our independently hashed scope challenge.
    const verified = await supabase.auth.verifyOtp({
      token_hash: parsed.data.tokenHash,
      type: "magiclink",
    });
    if (verified.error || !verified.data.user || !verified.data.session) {
      await supabase.auth.signOut();
      return invalidResponse();
    }
    authUserId = verified.data.user.id;

    stage = "SESSION_CLAIMS";
    const claims = await supabase.auth.getClaims(verified.data.session.access_token);
    const sessionId = claims.data?.claims?.session_id;
    if (typeof sessionId !== "string") {
      await supabase.auth.signOut();
      return invalidResponse();
    }

    stage = "TRUSTED_SESSION";
    const challenge = await completeBuyerLogin({
      challengeId: parsed.data.challenge,
      tokenHash: parsed.data.tokenHash,
      authUserId,
      sessionId,
      userAgent: request.headers.get("user-agent"),
    });
    if (!challenge) {
      await supabase.auth.signOut();
      return invalidResponse();
    }

    return NextResponse.json(
      { next: challenge.requestedPath },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    const stableError = error instanceof Error && /^[A-Z0-9_]{3,64}$/.test(error.message)
      ? error.message
      : `BUYER_LOGIN_${stage}_FAILED`;
    console.error("buyer_login_verification_failed", { stage, errorType: stableError });
    await recordBuyerLoginVerificationFailure(authUserId, stableError);
    await supabase.auth.signOut().catch(() => undefined);
    return invalidResponse();
  }
}
