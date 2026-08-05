import { NextResponse } from "next/server";
import { expireOverdueSuccessFees } from "@/lib/quotes/selection";
import { processWhatsAppJobs } from "@/lib/whatsapp/processor";
import { runProductionMonitoringSafely } from "@/lib/monitoring/operational-alerts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const expired = await expireOverdueSuccessFees();
    const whatsappProcessed = await processWhatsAppJobs({ limit: 20 });
    const monitoring = await runProductionMonitoringSafely();
    return NextResponse.json({ ok: true, expired, whatsappProcessed, monitoring });
  } catch (error) {
    console.error("Success-fee expiry job failed", error);
    return NextResponse.json({ error: "Expiry job failed" }, { status: 500 });
  }
}
