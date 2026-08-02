import { NextResponse } from "next/server";
import { getCurrentSession, getPrimarySupplierCompanyId } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { createClient } from "@/lib/supabase/auth-server";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (session) {
    await writeAuditLog({ actorUserId: session.userId, supplierCompanyId: getPrimarySupplierCompanyId(session) ?? undefined, action: "AUTH.LOGOUT", entityType: "PortalProfile", entityId: session.userId, summary: "User signed out", request }).catch(() => undefined);
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true, redirectTo: "/login" });
}
