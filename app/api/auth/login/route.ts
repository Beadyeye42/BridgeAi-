import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/auth-server";
import { loginSchema, validationError } from "@/lib/auth/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
  if (!data.user.email_confirmed_at) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "Verify your email before signing in" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, redirectTo: "/dashboard" });
}
