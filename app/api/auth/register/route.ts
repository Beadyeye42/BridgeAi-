import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { trustedPrisma } from "@/lib/db";
import { registerSchema, validationError } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/auth-server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
const TERMS_VERSION = "supplier-terms-2026-08-02";

export async function POST(request: Request) {
  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const origin = process.env.APP_URL ?? new URL(request.url).origin;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${origin}/auth/callback?next=/dashboard` },
  });
  if (error || !data.user || data.user.identities?.length === 0) {
    return NextResponse.json({ error: error?.message ?? "An account already exists for this email" }, { status: 409 });
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
      await trustedPrisma.$queryRaw`
        SELECT bridge_private.bootstrap_supplier(
          ${data.user.id}::uuid, ${parsed.data.email}, ${parsed.data.firstName},
          ${parsed.data.lastName}, ${parsed.data.companyName!}, ${parsed.data.phone!}, ${TERMS_VERSION}
        )
      `;
    }
  } catch (cause) {
    await getSupabaseAdmin().auth.admin.deleteUser(data.user.id).catch(() => undefined);
    console.error("Supplier bootstrap failed", cause);
    return NextResponse.json({ error: "We could not create your supplier workspace." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    redirectTo: data.session ? "/dashboard" : undefined,
    message: data.session ? undefined : "Check your email to verify your account before signing in.",
  }, { status: 201 });
}
