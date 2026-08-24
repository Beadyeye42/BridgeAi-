import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/auth-server";

// Supabase Auth remains the source of truth. React's request cache avoids
// re-verifying the same cookie several times during one server render.
export const getVerifiedAuthContext = cache(async () => {
  const supabase = await createClient();
  const claimsResult = await supabase.auth.getClaims();
  if (claimsResult.error || !claimsResult.data?.claims) return null;
  const { data, error } = await supabase.auth.getUser();
  const claims = claimsResult.data?.claims;
  const sessionId = typeof claims?.session_id === "string" ? claims.session_id : null;
  if (
    error
    || claimsResult.error
    || !data.user
    || !data.user.email_confirmed_at
    || claims?.sub !== data.user.id
    || !sessionId
    || !/^[0-9a-f-]{36}$/i.test(sessionId)
  ) return null;
  return { user: data.user, sessionId };
});

export const getVerifiedAuthUser = cache(async () => (await getVerifiedAuthContext())?.user ?? null);
