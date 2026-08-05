export type OperationalIssueSnapshot = {
  failedWhatsAppJobs: Array<{ id: string; type: string; attempts: number; errorCode: string | null }>;
  failedStripeWebhooks: Array<{ id: string; eventType: string; retryCount: number; failureReason: string | null }>;
  problemAttachments: Array<{ id: string; fileName: string; scanStatus: string; createdAt: Date }>;
  storageEvents: Array<{ id: string; severity: "ERROR" | "CRITICAL"; code: string; message: string }>;
};

export type OperationalAlertCandidate = {
  fingerprint: string;
  source: string;
  severity: "WARNING" | "ERROR" | "CRITICAL";
  title: string;
  body: string;
  actionUrl: string;
};

function safeDetail(value: string | null, fallback: string) {
  return (value || fallback).replace(/[\r\n]+/g, " ").slice(0, 240);
}

export function buildOperationalAlertCandidates(
  snapshot: OperationalIssueSnapshot,
  applicationUrl: string,
): OperationalAlertCandidate[] {
  const operationsUrl = `${applicationUrl.replace(/\/$/, "")}/admin/system`;
  return [
    ...snapshot.failedWhatsAppJobs.map((job) => ({
      fingerprint: `whatsapp-job:${job.id}`,
      source: "WHATSAPP",
      severity: "ERROR" as const,
      title: "WhatsApp processing failed",
      body: `${job.type.replaceAll("_", " ")} failed after ${job.attempts} attempt${job.attempts === 1 ? "" : "s"}. Code: ${safeDetail(job.errorCode, "UNKNOWN")}.`,
      actionUrl: operationsUrl,
    })),
    ...snapshot.failedStripeWebhooks.map((event) => ({
      fingerprint: `stripe-webhook:${event.id}`,
      source: "STRIPE",
      severity: "CRITICAL" as const,
      title: "Stripe webhook requires redelivery",
      body: `${event.eventType} is unprocessed after ${event.retryCount} retr${event.retryCount === 1 ? "y" : "ies"}. ${safeDetail(event.failureReason, "Processing failed")}.`,
      actionUrl: operationsUrl,
    })),
    ...snapshot.problemAttachments.map((attachment) => ({
      fingerprint: `attachment:${attachment.id}:${attachment.scanStatus}`,
      source: "ATTACHMENT",
      severity: attachment.scanStatus === "PENDING" ? "WARNING" as const : "ERROR" as const,
      title: attachment.scanStatus === "PENDING" ? "Attachment security check is delayed" : "Attachment security check failed",
      body: `${attachment.fileName.slice(0, 120)} is ${attachment.scanStatus.toLowerCase()} and is not available to authorised suppliers.`,
      actionUrl: operationsUrl,
    })),
    ...snapshot.storageEvents.map((event) => ({
      fingerprint: `system-event:${event.id}`,
      source: "ATTACHMENT",
      severity: event.severity,
      title: "Attachment storage operation failed",
      body: `${event.code}: ${safeDetail(event.message, "Storage operation failed")}.`,
      actionUrl: operationsUrl,
    })),
  ];
}
