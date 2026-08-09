import "server-only";
import { createHash } from "node:crypto";
import { applicationOrigin } from "@/lib/config";
import { runAsDatabaseWorker } from "@/lib/db";
import { operationalEmailConfiguration, sendOperationalAlertEmail } from "@/lib/email";
import { buildOperationalAlertCandidates } from "@/lib/monitoring/candidates";

const STALE_ATTACHMENT_MS = 15 * 60_000;
const STALE_DELIVERY_LOCK_MS = 10 * 60_000;
const MAX_DELIVERY_ATTEMPTS = 5;
const BATCH_SIZE = 20;

function monitoringOrigin() {
  return applicationOrigin(process.env.APP_URL || "http://localhost:3000");
}

export async function discoverOperationalAlerts(now = new Date()) {
  const staleAttachmentBefore = new Date(now.getTime() - STALE_ATTACHMENT_MS);
  const [failedWhatsAppJobs, failedStripeWebhooks, problemAttachments, storageEvents] = await runAsDatabaseWorker("production_monitoring", (tx) => Promise.all([
    tx.whatsAppJob.findMany({
      where: {
        status: "FAILED",
        NOT: { errorCode: { startsWith: "SUPERSEDED_" } },
      },
      select: { id: true, type: true, attempts: true, errorCode: true },
      take: 100,
    }),
    tx.webhookEvent.findMany({
      where: { provider: "STRIPE", failedAt: { not: null }, processedAt: null },
      select: { id: true, eventType: true, retryCount: true, failureReason: true },
      take: 100,
    }),
    tx.attachment.findMany({
      where: {
        OR: [
          { scanStatus: { in: ["FAILED", "REJECTED"] } },
          { scanStatus: "PENDING", createdAt: { lt: staleAttachmentBefore } },
        ],
      },
      select: { id: true, fileName: true, scanStatus: true, createdAt: true },
      take: 100,
    }),
    tx.systemEvent.findMany({
      where: {
        status: { not: "RESOLVED" },
        severity: { in: ["ERROR", "CRITICAL"] },
        OR: [
          { source: { in: ["storage", "attachment"] } },
          { code: { contains: "UPLOAD_FAILED" } },
          { code: { contains: "ATTACHMENT" } },
        ],
      },
      select: { id: true, severity: true, code: true, message: true },
      take: 100,
    }),
  ]));
  const candidates = buildOperationalAlertCandidates({
    failedWhatsAppJobs,
    failedStripeWebhooks,
    problemAttachments,
    storageEvents: storageEvents.map((event) => ({
      ...event,
      severity: event.severity as "ERROR" | "CRITICAL",
    })),
  }, monitoringOrigin());
  if (!candidates.length) return { discovered: 0, queued: 0 };

  return runAsDatabaseWorker("production_monitoring", async (tx) => {
    const existing = await tx.productionAlert.findMany({
      where: { fingerprint: { in: candidates.map((candidate) => candidate.fingerprint) } },
      select: { fingerprint: true },
    });
    const known = new Set(existing.map((alert) => alert.fingerprint));
    const fresh = candidates.filter((candidate) => !known.has(candidate.fingerprint));
    if (fresh.length) {
      await tx.productionAlert.createMany({ data: fresh });
    }
    return { discovered: candidates.length, queued: fresh.length };
  });
}

async function claimAlertBatch(now = new Date()) {
  const staleLockBefore = new Date(now.getTime() - STALE_DELIVERY_LOCK_MS);
  return runAsDatabaseWorker("production_monitoring", async (tx) => {
    await tx.productionAlert.updateMany({
      where: { status: "PROCESSING", lockedAt: { lt: staleLockBefore }, attempts: { lt: MAX_DELIVERY_ATTEMPTS } },
      data: { status: "FAILED", lockedAt: null, failedAt: now, availableAt: now, lastError: "STALE_DELIVERY_LOCK" },
    });
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM bridge_ai."ProductionAlert"
      WHERE status IN ('PENDING', 'FAILED')
        AND "availableAt" <= ${now}
        AND attempts < ${MAX_DELIVERY_ATTEMPTS}
      ORDER BY severity DESC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    `;
    const ids = rows.map((row) => row.id);
    if (!ids.length) return [];
    await tx.productionAlert.updateMany({
      where: { id: { in: ids } },
      data: { status: "PROCESSING", lockedAt: now, attempts: { increment: 1 }, failedAt: null, lastError: null },
    });
    return tx.productionAlert.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: "asc" } });
  });
}

export async function dispatchOperationalAlerts(now = new Date()) {
  const config = operationalEmailConfiguration();
  if (!config.configured) return { configured: false as const, sent: 0, reason: config.reason };
  const alerts = await claimAlertBatch(now);
  if (!alerts.length) return { configured: true as const, sent: 0, reason: null };
  const ids = alerts.map((alert) => alert.id).sort();
  const digest = createHash("sha256").update(ids.join(":"), "utf8").digest("hex").slice(0, 48);
  try {
    const result = await sendOperationalAlertEmail(alerts.map((alert) => ({
      severity: alert.severity === "INFO" ? "WARNING" : alert.severity,
      title: alert.title,
      body: alert.body,
      actionUrl: alert.actionUrl,
    })), `bridge-ai-monitoring-${digest}`);
    await runAsDatabaseWorker("production_monitoring", async (tx) => {
      await tx.productionAlert.updateMany({
        where: { id: { in: ids }, status: "PROCESSING" },
        data: { status: "SENT", sentAt: new Date(), lockedAt: null, providerEmailId: result.providerEmailId },
      });
    });
    return { configured: true as const, sent: alerts.length, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown alert delivery failure";
    const attempts = Math.max(...alerts.map((alert) => alert.attempts));
    const retryDelayMs = Math.min(6 * 60 * 60_000, Math.max(60_000, 2 ** attempts * 60_000));
    await runAsDatabaseWorker("production_monitoring", async (tx) => {
      await tx.productionAlert.updateMany({
        where: { id: { in: ids }, status: "PROCESSING" },
        data: { status: "FAILED", failedAt: new Date(), lockedAt: null, lastError: message, availableAt: new Date(Date.now() + retryDelayMs) },
      });
    });
    return { configured: true as const, sent: 0, reason: message };
  }
}

export async function runProductionMonitoring() {
  const discovery = await discoverOperationalAlerts();
  const delivery = await dispatchOperationalAlerts();
  return { ...discovery, ...delivery };
}

export async function runProductionMonitoringSafely() {
  try {
    return await runProductionMonitoring();
  } catch (error) {
    console.error("Production monitoring failed", error);
    return { discovered: 0, queued: 0, configured: false as const, sent: 0, reason: "Monitoring execution failed" };
  }
}
