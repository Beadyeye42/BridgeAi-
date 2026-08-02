import "server-only";
import { createClient } from "@/lib/supabase/auth-server";

export const PRIVATE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "bridge-ai-private";

export async function getPrivateStorage() {
  return createClient();
}
