import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/api";
import { writeAuditLog } from "@/lib/audit";
import { runProductionMonitoring } from "@/lib/monitoring/operational-alerts";
import { processWhatsAppJobs } from "@/lib/whatsapp/processor";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  try {
    await writeAuditLog({
      actorUserId: auth.session.userId,
      action: "ADMIN.PRODUCTION_MONITORING_RUN",
      entityType: "ProductionAlert",
      summary: "Administrator started the production monitoring check",
      metadata: { status: "STARTED" },
      request,
    });
    const processedWhatsAppJobs = await processWhatsAppJobs({ limit: 20 });
    const result = await runProductionMonitoring();
    return NextResponse.json({ ok: true, processedWhatsAppJobs, ...result });
  } catch (error) {
    console.error("Administrator production monitoring check failed", error);
    return NextResponse.json({ error: "Production monitoring check failed" }, { status: 500 });
  }
}
