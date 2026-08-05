import { NextResponse } from "next/server";
import { runProductionMonitoring } from "@/lib/monitoring/operational-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runProductionMonitoring()) });
  } catch (error) {
    console.error("Production monitoring cron failed", error);
    return NextResponse.json({ error: "Production monitoring failed" }, { status: 500 });
  }
}
