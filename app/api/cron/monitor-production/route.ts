import { NextResponse } from "next/server";
import { runProductionMonitoring } from "@/lib/monitoring/operational-alerts";
import { processSupplierEmailsSafely } from "@/lib/notifications/email-worker";
import { processWhatsAppJobs } from "@/lib/whatsapp/processor";
import { validateMatureAffiliateCommissions } from "@/lib/affiliates/accounting-worker";
import { processAffiliateEmailsSafely } from "@/lib/affiliates/email-worker";
import { expireElapsedMemberships } from "@/lib/billing/expiry";
import { expireAndReplaceSupplierInvitations } from "@/lib/matching/replacements";
import { notifySuppliersWithStaleCapacity } from "@/lib/matching/stale-capacity";
import { runMaintenanceSteps } from "@/lib/monitoring/maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const maintenance = await runMaintenanceSteps({
      membershipExpiry: () => expireElapsedMemberships(),
      processedWhatsAppJobs: () => processWhatsAppJobs({ limit: 50, concurrency: 5, flushSupplierEmails: false }),
      invitationRecovery: () => expireAndReplaceSupplierInvitations({ limit: 100 }),
      staleCapacityReminders: () => notifySuppliersWithStaleCapacity({ limit: 100 }),
      supplierEmails: () => processSupplierEmailsSafely({ limit: 50 }),
      affiliateValidation: async () => (await validateMatureAffiliateCommissions()).map((result) => ({ ...result, availableAmountPence: result.availableAmountPence.toString() })),
      affiliateEmails: () => processAffiliateEmailsSafely(),
      monitoring: () => runProductionMonitoring(),
    });
    const { monitoring, ...results } = maintenance.results;
    return NextResponse.json({
      ...results,
      ...(monitoring as object),
      ok: maintenance.ok,
      failures: maintenance.failures,
    }, { status: maintenance.ok ? 200 : 500 });
  } catch (error) {
    console.error("Production monitoring cron failed", error);
    return NextResponse.json({ error: "Production monitoring failed" }, { status: 500 });
  }
}
