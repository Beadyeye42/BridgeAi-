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
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });
  if (error?.status === 429) {
    return NextResponse.json(
      { error: "Please wait a few minutes before requesting another reset email." },
      { status: 429 },
    );
  }
  if (error) {
    console.error("Password recovery request failed", { code: error.code, status: error.status });
    return NextResponse.json(
      { error: "We could not send the reset email just now. Please try again shortly." },
      { status: 503 },
    );
  }
  return accepted;
}
