import { NextResponse } from "next/server";
import { forgotPasswordSchema } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/auth-server";
import { applicationOrigin } from "@/lib/config";

export async function POST(request: Request) {
  const parsed = forgotPasswordSchema.safeParse(await request.json().catch(() => null));
  const accepted = NextResponse.json({ ok: true, message: "If that account exists, a reset link is on its way." });
  if (!parsed.success) return accepted;
  let origin: string;
  try {
    origin = applicationOrigin(request.url);
  } catch {
    return NextResponse.json({ error: "Password recovery is not configured." }, { status: 503 });
  }
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${origin}/auth/callback?next=/reset-password` });
  return accepted;
}
