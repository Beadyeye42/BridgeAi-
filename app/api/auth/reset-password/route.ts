import { NextResponse } from "next/server";
import { resetPasswordSchema, validationError } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/auth-server";

export async function POST(request: Request) {
  const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Open the password-reset link from your email first" }, { status: 401 });
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await supabase.auth.signOut({ scope: "global" });
  return NextResponse.json({ ok: true, redirectTo: "/login?reset=success" });
}
