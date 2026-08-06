import "server-only";
import { applicationOrigin } from "@/lib/config";
import { runAsDatabaseWorker } from "@/lib/db";
import { sendSupplierWinnerEmail, supplierEmailConfiguration } from "@/lib/email";

const MAX_DELIVERY_ATTEMPTS = 5;
const STALE_LOCK_MS = 10 * 60_000;
const DEFAULT_BATCH_SIZE = 10;

type ClaimedNotification = {
  id: string;
  userId: string;
  supplierCompanyId: string | null;
  title: string;
  body: string;
  actionUrl: string | null;
  deliveryAttempts: number;
  user: { email: string; firstName: string };
};

function portalOrigin() {
  return applicationOrigin(process.env.APP_URL || "http://localhost:3000");
}

async function claimWinnerEmailBatch(limit: number, now = new Date()): Promise<ClaimedNotification[]> {
  const staleLockBefore = new Date(now.getTime() - STALE_LOCK_MS);
  return runAsDatabaseWorker("supplier_email", async (tx) => {
    await tx.notification.updateMany({
      where: {
        channel: "EMAIL",
        type: "QUOTATION_ACCEPTED",
        sentAt: null,
        lockedAt: { lt: staleLockBefore },
        deliveryAttempts: { lt: MAX_DELIVERY_ATTEMPTS },
      },
      data: { lockedAt: null, failedAt: now, failureReason: "STALE_DELIVERY_LOCK", availableAt: now },
    });
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT notification.id
      FROM bridge_ai."Notification" notification
      JOIN bridge_ai.portal_profiles profile ON profile.id = notification."userId"
      WHERE notification.channel = 'EMAIL'
        AND notification.type = 'QUOTATION_ACCEPTED'
        AND notification."sentAt" IS NULL
        AND notification."availableAt" <= ${now}
        AND notification."deliveryAttempts" < ${MAX_DELIVERY_ATTEMPTS}
        AND notification."lockedAt" IS NULL
        AND profile.status = 'ACTIVE'
      ORDER BY notification."createdAt" ASC
      FOR UPDATE OF notification SKIP LOCKED
      LIMIT ${Math.max(1, Math.min(limit, 50))}
    `;
    const ids = rows.map((row) => row.id);
    if (!ids.length) return [];
    await tx.notification.updateMany({
      where: { id: { in: ids }, sentAt: null, lockedAt: null },
      data: { lockedAt: now, lastAttemptAt: now, deliveryAttempts: { increment: 1 }, failedAt: null, failureReason: null },
    });
    return tx.notification.findMany({
      where: { id: { in: ids }, lockedAt: now },
      select: {
        id: true,
        userId: true,
        supplierCompanyId: true,
        title: true,
        body: true,
        actionUrl: true,
        deliveryAttempts: true,
        user: { select: { email: true, firstName: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  });
}

async function markWinnerEmailSent(notification: ClaimedNotification, providerMessageId: string | null) {
  await runAsDatabaseWorker("supplier_email", async (tx) => {
    await tx.notification.update({
      where: { id: notification.id },
      data: { sentAt: new Date(), lockedAt: null, failedAt: null, failureReason: null, providerMessageId },
    });
    await tx.auditLog.create({ data: {
      supplierCompanyId: notification.supplierCompanyId,
      action: "NOTIFICATION.SUPPLIER_WINNER_EMAIL_SENT",
      entityType: "Notification",
      entityId: notification.id,
      summary: "Supplier winner email delivered through Resend",
      metadata: { providerMessageId, deliveryAttempts: notification.deliveryAttempts },
    } });
  });
}

async function markWinnerEmailFailed(notification: ClaimedNotification, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown supplier email delivery failure";
  const terminal = notification.deliveryAttempts >= MAX_DELIVERY_ATTEMPTS;
  const retryDelayMs = Math.min(6 * 60 * 60_000, Math.max(60_000, 2 ** notification.deliveryAttempts * 60_000));
  await runAsDatabaseWorker("supplier_email", async (tx) => {
    await tx.notification.update({
      where: { id: notification.id },
      data: {
        lockedAt: null,
        failedAt: new Date(),
        failureReason: message,
        availableAt: new Date(Date.now() + retryDelayMs),
      },
    });
    await tx.auditLog.create({ data: {
      supplierCompanyId: notification.supplierCompanyId,
      action: terminal ? "NOTIFICATION.SUPPLIER_WINNER_EMAIL_EXHAUSTED" : "NOTIFICATION.SUPPLIER_WINNER_EMAIL_RETRY_SCHEDULED",
      entityType: "Notification",
      entityId: notification.id,
      summary: terminal ? "Supplier winner email exhausted automatic retries" : "Supplier winner email failed and was scheduled for retry",
      metadata: { deliveryAttempts: notification.deliveryAttempts, failure: message },
    } });
    if (terminal) {
      await tx.systemEvent.create({ data: {
        severity: "ERROR",
        status: "OPEN",
        source: "RESEND",
        code: "SUPPLIER_WINNER_EMAIL_FAILED",
        message: "A supplier winner notification could not be delivered after five attempts",
        context: { notificationId: notification.id, supplierCompanyId: notification.supplierCompanyId },
      } });
    }
  });
}

export async function processSupplierWinnerEmails(input: { limit?: number } = {}) {
  const config = supplierEmailConfiguration();
  if (!config.configured) return { configured: false as const, processed: 0, sent: 0, failed: 0, reason: config.reason };
  const notifications = await claimWinnerEmailBatch(input.limit ?? DEFAULT_BATCH_SIZE);
  let sent = 0;
  let failed = 0;
  for (const notification of notifications) {
    try {
      const relativeActionUrl = notification.actionUrl?.startsWith("/") ? notification.actionUrl : "/dashboard/requests";
      const result = await sendSupplierWinnerEmail(notification.user.email, {
        recipientFirstName: notification.user.firstName,
        title: notification.title,
        body: notification.body,
        portalUrl: new URL(relativeActionUrl, portalOrigin()).toString(),
      }, `bridge-ai-supplier-winner-${notification.id}`);
      await markWinnerEmailSent(notification, result.providerEmailId);
      sent += 1;
    } catch (error) {
      await markWinnerEmailFailed(notification, error);
      failed += 1;
    }
  }
  return { configured: true as const, processed: notifications.length, sent, failed, reason: null };
}

export async function processSupplierWinnerEmailsSafely(input: { limit?: number } = {}) {
  try {
    return await processSupplierWinnerEmails(input);
  } catch (error) {
    console.error("Supplier winner email processing failed", error);
    return { configured: true as const, processed: 0, sent: 0, failed: 1, reason: "Supplier email processing failed" };
  }
}
