import "server-only";
import { applicationOrigin } from "@/lib/config";
import { runAsDatabaseWorker } from "@/lib/db";
import { sendSupplierNotificationEmail, supplierEmailConfiguration } from "@/lib/email";

const MAX_DELIVERY_ATTEMPTS = 5;
const STALE_LOCK_MS = 10 * 60_000;
const DEFAULT_BATCH_SIZE = 10;

type ClaimedNotification = {
  id: string;
  userId: string;
  supplierCompanyId: string | null;
  type: "NEW_QUOTE_REQUEST" | "QUOTATION_ACCEPTED" | "BUYER_QUESTION";
  title: string;
  body: string;
  actionUrl: string | null;
  deliveryAttempts: number;
  user: { email: string; firstName: string };
};

function portalOrigin() {
  return applicationOrigin(process.env.APP_URL || "http://localhost:3000");
}

async function claimSupplierEmailBatch(limit: number, now = new Date()): Promise<ClaimedNotification[]> {
  const staleLockBefore = new Date(now.getTime() - STALE_LOCK_MS);
  return runAsDatabaseWorker("supplier_email", async (tx) => {
    await tx.notification.updateMany({
      where: {
        channel: "EMAIL",
        type: { in: ["NEW_QUOTE_REQUEST", "QUOTATION_ACCEPTED", "BUYER_QUESTION"] },
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
        AND notification.type IN ('NEW_QUOTE_REQUEST', 'QUOTATION_ACCEPTED', 'BUYER_QUESTION')
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
    const notifications = await tx.notification.findMany({
      where: { id: { in: ids }, lockedAt: now },
      select: {
        id: true,
        userId: true,
        supplierCompanyId: true,
        type: true,
        title: true,
        body: true,
        actionUrl: true,
        deliveryAttempts: true,
        user: { select: { email: true, firstName: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return notifications.flatMap((notification): ClaimedNotification[] => {
      if (notification.type !== "NEW_QUOTE_REQUEST"
        && notification.type !== "QUOTATION_ACCEPTED"
        && notification.type !== "BUYER_QUESTION") return [];
      return [{ ...notification, type: notification.type }];
    });
  });
}

async function markSupplierEmailSent(notification: ClaimedNotification, providerMessageId: string | null) {
  const isOpportunity = notification.type === "NEW_QUOTE_REQUEST";
  const isQuestion = notification.type === "BUYER_QUESTION";
  await runAsDatabaseWorker("supplier_email", async (tx) => {
    await tx.notification.update({
      where: { id: notification.id },
      data: { sentAt: new Date(), lockedAt: null, failedAt: null, failureReason: null, providerMessageId },
    });
    await tx.auditLog.create({ data: {
      supplierCompanyId: notification.supplierCompanyId,
      action: isOpportunity ? "NOTIFICATION.SUPPLIER_OPPORTUNITY_EMAIL_SENT" : isQuestion ? "NOTIFICATION.BUYER_QUESTION_EMAIL_SENT" : "NOTIFICATION.SUPPLIER_WINNER_EMAIL_SENT",
      entityType: "Notification",
      entityId: notification.id,
      summary: isOpportunity ? "Supplier opportunity email delivered through Resend" : isQuestion ? "Private buyer-question email delivered through Resend" : "Supplier winner email delivered through Resend",
      metadata: { notificationType: notification.type, providerMessageId, deliveryAttempts: notification.deliveryAttempts },
    } });
  });
}

async function markSupplierEmailFailed(notification: ClaimedNotification, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown supplier email delivery failure";
  const terminal = notification.deliveryAttempts >= MAX_DELIVERY_ATTEMPTS;
  const subject = notification.type === "NEW_QUOTE_REQUEST" ? "SUPPLIER_OPPORTUNITY_EMAIL" : notification.type === "BUYER_QUESTION" ? "BUYER_QUESTION_EMAIL" : "SUPPLIER_WINNER_EMAIL";
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
      action: terminal ? `NOTIFICATION.${subject}_EXHAUSTED` : `NOTIFICATION.${subject}_RETRY_SCHEDULED`,
      entityType: "Notification",
      entityId: notification.id,
      summary: terminal ? "Supplier email exhausted automatic retries" : "Supplier email failed and was scheduled for retry",
      metadata: { notificationType: notification.type, deliveryAttempts: notification.deliveryAttempts, failure: message },
    } });
    if (terminal) {
      await tx.systemEvent.create({ data: {
        severity: "ERROR",
        status: "OPEN",
        source: "RESEND",
        code: "SUPPLIER_EMAIL_FAILED",
        message: "A supplier notification email could not be delivered after five attempts",
        context: { notificationId: notification.id, notificationType: notification.type, supplierCompanyId: notification.supplierCompanyId },
      } });
    }
  });
}

export async function processSupplierEmails(input: { limit?: number } = {}) {
  const config = supplierEmailConfiguration();
  if (!config.configured) return { configured: false as const, processed: 0, sent: 0, failed: 0, reason: config.reason };
  const notifications = await claimSupplierEmailBatch(input.limit ?? DEFAULT_BATCH_SIZE);
  let sent = 0;
  let failed = 0;
  for (const notification of notifications) {
    try {
      const relativeActionUrl = notification.actionUrl?.startsWith("/") ? notification.actionUrl : "/dashboard/requests";
      const result = await sendSupplierNotificationEmail(notification.user.email, {
        kind: notification.type,
        recipientFirstName: notification.user.firstName,
        title: notification.title,
        body: notification.body,
        portalUrl: new URL(relativeActionUrl, portalOrigin()).toString(),
      }, notification.type === "QUOTATION_ACCEPTED"
        ? `bridge-it-supplier-selected-${notification.id}`
        : notification.type === "BUYER_QUESTION"
          ? `bridge-it-buyer-question-${notification.id}`
          : `bridge-it-supplier-opportunity-${notification.id}`);
      await markSupplierEmailSent(notification, result.providerEmailId);
      sent += 1;
    } catch (error) {
      await markSupplierEmailFailed(notification, error);
      failed += 1;
    }
  }
  return { configured: true as const, processed: notifications.length, sent, failed, reason: null };
}

export async function processSupplierEmailsSafely(input: { limit?: number } = {}) {
  try {
    return await processSupplierEmails(input);
  } catch (error) {
    console.error("Supplier email processing failed", error);
    return { configured: true as const, processed: 0, sent: 0, failed: 1, reason: "Supplier email processing failed" };
  }
}

export const processSupplierWinnerEmails = processSupplierEmails;
export const processSupplierWinnerEmailsSafely = processSupplierEmailsSafely;
