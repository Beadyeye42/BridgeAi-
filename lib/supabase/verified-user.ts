import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/auth-server";

// Supabase Auth remains the source of truth. React's request cache avoids
// re-verifying the same cookie several times during one server render.
export const getVerifiedAuthUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !data.user.email_confirmed_at) return null;
  return data.user;
});
