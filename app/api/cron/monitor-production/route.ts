import { NextResponse } from "next/server";
import { runProductionMonitoring } from "@/lib/monitoring/operational-alerts";
import { processSupplierEmailsSafely } from "@/lib/notifications/email-worker";
import { processWhatsAppJobs } from "@/lib/whatsapp/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const processedWhatsAppJobs = await processWhatsAppJobs({ limit: 50 });
    const supplierEmails = await processSupplierEmailsSafely({ limit: 50 });
    return NextResponse.json({ ok: true, processedWhatsAppJobs, supplierEmails, ...(await runProductionMonitoring()) });
  } catch (error) {
    console.error("Production monitoring cron failed", error);
    return NextResponse.json({ error: "Production monitoring failed" }, { status: 500 });
  }
}
