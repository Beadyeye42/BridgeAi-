import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/api";
import { writeAuditLog } from "@/lib/audit";
import { trustedPrisma } from "@/lib/db";
import { runProductionMonitoring } from "@/lib/monitoring/operational-alerts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  try {
    const result = await runProductionMonitoring();
    await writeAuditLog({
      actorUserId: auth.session.userId,
      action: "ADMIN.PRODUCTION_MONITORING_RUN",
      entityType: "ProductionAlert",
      summary: "Administrator ran the production monitoring check",
      metadata: { discovered: result.discovered, queued: result.queued, sent: result.sent, configured: result.configured },
      request,
    }, trustedPrisma);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Administrator production monitoring check failed", error);
    return NextResponse.json({ error: "Production monitoring check failed" }, { status: 500 });
  }
}
