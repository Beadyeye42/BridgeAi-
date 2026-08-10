import { NextResponse } from "next/server";
import { runProductionMonitoring } from "@/lib/monitoring/operational-alerts";
import { processSupplierEmailsSafely } from "@/lib/notifications/email-worker";
import { processWhatsAppJobs } from "@/lib/whatsapp/processor";
import { validateMatureAffiliateCommissions } from "@/lib/affiliates/accounting-worker";
import { processAffiliateEmailsSafely } from "@/lib/affiliates/email-worker";
import { expireElapsedMemberships } from "@/lib/billing/expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const membershipExpiry = await expireElapsedMemberships();
    const processedWhatsAppJobs = await processWhatsAppJobs({ limit: 50 });
    const supplierEmails = await processSupplierEmailsSafely({ limit: 50 });
    const affiliateValidation = await validateMatureAffiliateCommissions();
    const affiliateEmails = await processAffiliateEmailsSafely();
    return NextResponse.json({
      ok: true,
      membershipExpiry,
      processedWhatsAppJobs,
      supplierEmails,
      affiliateValidation: affiliateValidation.map((result) => ({ ...result, availableAmountPence: result.availableAmountPence.toString() })),
      affiliateEmails,
      ...(await runProductionMonitoring()),
    });
  } catch (error) {
    console.error("Production monitoring cron failed", error);
    return NextResponse.json({ error: "Production monitoring failed" }, { status: 500 });
  }
}
