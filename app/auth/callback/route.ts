import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { safeAuthNextPath } from "@/lib/auth/recovery-hash";
import { createClient } from "@/lib/supabase/auth-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeAuthNextPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const flowId = url.searchParams.get("sb_flow_id");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const supabase = await createClient();
  const result = code
    ? await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("Missing verification token") };
  return NextResponse.redirect(new URL(result.error ? "/login?auth=error" : next, url.origin));
}
