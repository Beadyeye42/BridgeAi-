import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { trustedPrisma } from "@/lib/db";
import { registerSchema, validationError } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/auth-server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { applicationOrigin } from "@/lib/config";
import {
  authUserWasCreatedForRequest,
  supplierBootstrapError,
  supplierSignUpError,
} from "@/lib/auth/registration-safety";

export const runtime = "nodejs";
const TERMS_VERSION = "supplier-terms-2026-08-10-v2";

export async function POST(request: Request) {
  const registrationStartedAt = Date.now();
  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  let origin: string;
  try {
    origin = applicationOrigin(request.url);
  } catch {
    return NextResponse.json({ error: "Account registration is not configured." }, { status: 503 });
  }

  if (!parsed.data.invitationToken) {
    try {
      const [preflight] = await trustedPrisma.$queryRaw<Array<{ status: string }>>`
        SELECT bridge_private.preflight_supplier_registration(
          ${parsed.data.email}, ${parsed.data.referralCode ?? null}
        ) AS status
      `;
      if (preflight?.status === "EMAIL_EXISTS") {
        return NextResponse.json({
          error: "This email is already linked to a Bridge-iT account. Sign in, reset the password, or contact support if you cannot access it.",
        }, { status: 409 });
      }
      if (preflight?.status === "INVALID_REFERRAL") {
        return NextResponse.json({ error: "This affiliate referral link is no longer valid." }, { status: 400 });
      }
      if (preflight?.status !== "OK") {
        return NextResponse.json({ error: "Account registration is temporarily unavailable." }, { status: 503 });
      }
    } catch (cause) {
      console.error("Supplier registration preflight failed", cause);
      return NextResponse.json({ error: "Account registration is temporarily unavailable." }, { status: 503 });
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${origin}/auth/callback?next=/dashboard` },
  });
  if (error || !data.user || data.user.identities?.length === 0) {
    const failure = supplierSignUpError(error, Boolean(data.user && data.user.identities?.length === 0));
    console.warn("Supplier Auth signup was not completed", { code: error?.code, status: error?.status });
    return NextResponse.json(
      { error: failure.message },
      {
        status: failure.status,
        headers: failure.retryAfterSeconds
          ? { "Retry-After": String(failure.retryAfterSeconds) }
          : undefined,
      },
    );
  }

  try {
    if (parsed.data.invitationToken) {
      const tokenHash = createHash("sha256").update(parsed.data.invitationToken).digest("hex");
      await trustedPrisma.$queryRaw`
        SELECT bridge_private.accept_supplier_invitation(
          ${data.user.id}::uuid, ${tokenHash}, ${parsed.data.email},
          ${parsed.data.firstName}, ${parsed.data.lastName}, ${TERMS_VERSION}
        )
      `;
    } else {
      if (parsed.data.referralCode) {
        await trustedPrisma.$queryRaw`
          SELECT bridge_private.bootstrap_referred_supplier(
            ${data.user.id}::uuid, ${parsed.data.email}, ${parsed.data.firstName},
            ${parsed.data.lastName}, ${parsed.data.companyName!}, ${parsed.data.phone!},
            ${TERMS_VERSION}, ${parsed.data.referralCode}
          )
        `;
      } else {
        await trustedPrisma.$queryRaw`
          SELECT bridge_private.bootstrap_supplier(
            ${data.user.id}::uuid, ${parsed.data.email}, ${parsed.data.firstName},
            ${parsed.data.lastName}, ${parsed.data.companyName!}, ${parsed.data.phone!}, ${TERMS_VERSION}
          )
        `;
      }
    }
  } catch (cause) {
    if (authUserWasCreatedForRequest(data.user.created_at, registrationStartedAt)) {
      await getSupabaseAdmin().auth.admin.deleteUser(data.user.id).catch((cleanupCause) => {
        console.error("Supplier Auth cleanup failed", cleanupCause);
      });
    }
    console.error("Supplier bootstrap failed", cause);
    const failure = supplierBootstrapError(cause);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }

  return NextResponse.json({
    ok: true,
    redirectTo: data.session ? "/dashboard" : undefined,
    message: data.session ? undefined : "Check your email to verify your account before signing in.",
  }, { status: 201 });
}
