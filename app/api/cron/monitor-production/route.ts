import { NextResponse } from "next/server";
import { runProductionMonitoring } from "@/lib/monitoring/operational-alerts";
import { processSupplierEmailsSafely } from "@/lib/notifications/email-worker";
import { processWhatsAppJobs } from "@/lib/whatsapp/processor";
import { validateMatureAffiliateCommissions } from "@/lib/affiliates/accounting-worker";
import { processAffiliateEmailsSafely } from "@/lib/affiliates/email-worker";
import { expireElapsedMemberships } from "@/lib/billing/expiry";
import { expireAndReplaceSupplierInvitations } from "@/lib/matching/replacements";
import { notifySuppliersWithStaleCapacity } from "@/lib/matching/stale-capacity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const membershipExpiry = await expireElapsedMemberships();
    const processedWhatsAppJobs = await processWhatsAppJobs({ limit: 50, concurrency: 5, flushSupplierEmails: false });
    const invitationRecovery = await expireAndReplaceSupplierInvitations({ limit: 100 });
    const staleCapacityReminders = await notifySuppliersWithStaleCapacity({ limit: 100 });
    const supplierEmails = await processSupplierEmailsSafely({ limit: 50 });
    const affiliateValidation = await validateMatureAffiliateCommissions();
    const affiliateEmails = await processAffiliateEmailsSafely();
    return NextResponse.json({
      ok: true,
      membershipExpiry,
      processedWhatsAppJobs,
      invitationRecovery,
      staleCapacityReminders,
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
