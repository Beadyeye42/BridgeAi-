import { NextResponse } from "next/server";
import { processWhatsAppJobs } from "@/lib/whatsapp/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const processed = await processWhatsAppJobs({ limit: 20 });
    return NextResponse.json({ ok: true, processed });
  } catch (error) {
    console.error("WhatsApp recovery worker failed", error);
    return NextResponse.json({ error: "WhatsApp worker failed" }, { status: 500 });
  }
}
