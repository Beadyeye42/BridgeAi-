import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type Attachment, type WhatsAppJob } from "@prisma/client";
import { applicationOrigin, metaContactTemplate, metaQuoteTemplate, whatsappConciergeConfig, whatsappMessagingPolicy } from "@/lib/config";
import { runAsDatabaseWorker } from "@/lib/db";
import { analyzeQuoteAttachment, quoteAttachmentAnalysisSchema, type QuoteAttachmentAnalysis } from "@/lib/ai/attachment-intake";
import { extractQuoteIntake, quoteDraftSchema, type QuoteDraft } from "@/lib/ai/quote-intake";
import { lookupPostcode, PostcodeLookupError } from "@/lib/location/postcodes";
import { findSupplierMatches } from "@/lib/matching/suppliers";
import { addSupplierResponseHours } from "@/lib/quotes/response-clock";
import { selectQuotationForCustomer } from "@/lib/quotes/selection";
import { decryptPrivateValue, encryptPrivateValue } from "@/lib/security/encryption";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PRIVATE_BUCKET } from "@/lib/storage";
import { downloadMetaMedia, sendMetaTemplate, sendMetaText } from "@/lib/whatsapp/meta-client";
import { writeWhatsAppSystemEvent } from "@/lib/whatsapp/system-events";
import {
  isMenuRequest,
  isNewQuoteRequest,
  newQuoteDetails,
  isQuoteHistoryRequest,
  isQuoteRefresh,
  isServiceWindowOpen,
  quoteMenu,
  wasReplyRecentlySent,
} from "@/lib/whatsapp/policy";
import {
  conversationProgress,
  quoteDraftFingerprint,
  repeatClarification,
  requiredQuestionKey,
} from "@/lib/whatsapp/intake-state";

const MAX_ATTEMPTS = 3;
const STALE_LOCK_MS = 5 * 60_000;

type LoadedJob = NonNullable<Awaited<ReturnType<typeof loadJob>>>;

async function writeWhatsAppAudit(
  tx: Prisma.TransactionClient,
  data: { action: string; entityType: string; entityId: string; summary: string; metadata?: Prisma.InputJsonValue },
) {
  await tx.$queryRaw`
    SELECT bridge_private.write_whatsapp_audit(
      ${data.action}, ${data.entityType}, ${data.entityId}, ${data.summary},
      ${JSON.stringify(data.metadata ?? {})}::jsonb
    )
  `;
}

function errorCode(error: unknown) {
  const raw = error instanceof Error ? error.message : "UNKNOWN";
  return raw.replace(/[^A-Z0-9_:-]/gi, "_").slice(0, 120) || "UNKNOWN";
}

async function claimJob() {
  return runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
    const exhausted = await tx.whatsAppJob.findMany({
      where: { status: "PROCESSING", lockedAt: { lt: staleBefore }, attempts: { gte: MAX_ATTEMPTS } },
      select: { id: true, type: true, attempts: true },
    });
    for (const stale of exhausted) {
      await tx.whatsAppJob.update({
        where: { id: stale.id },
        data: { status: "FAILED", failedAt: new Date(), lockedAt: null, errorCode: "STALE_JOB_EXHAUSTED" },
      });
      await writeWhatsAppSystemEvent(tx, "whatsapp_ai", {
        severity: "ERROR",
        code: "WHATSAPP_JOB_FAILED",
        message: "A stale WhatsApp background job exhausted its retry policy",
        context: { jobId: stale.id, jobType: stale.type, errorCode: "STALE_JOB_EXHAUSTED", attempts: stale.attempts },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.JOB_FAILED",
        entityType: "WhatsAppJob",
        entityId: stale.id,
        summary: "A stale WhatsApp background job exhausted its retry policy",
        metadata: { type: stale.type, errorCode: "STALE_JOB_EXHAUSTED", attempts: stale.attempts },
      });
    }
    await tx.whatsAppJob.updateMany({
      where: { status: "PROCESSING", lockedAt: { lt: staleBefore }, attempts: { lt: MAX_ATTEMPTS } },
      data: { status: "PENDING", lockedAt: null, availableAt: new Date() },
    });
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT candidate.id
      FROM bridge_ai."WhatsAppJob" candidate
      WHERE candidate.status = 'PENDING'
        AND candidate."availableAt" <= now()
        AND candidate.attempts < ${MAX_ATTEMPTS}
        AND NOT EXISTS (
          SELECT 1
          FROM bridge_ai."WhatsAppJob" earlier
          WHERE earlier."conversationId" = candidate."conversationId"
            AND earlier.status IN ('PENDING', 'PROCESSING')
            AND (earlier."createdAt", earlier.id) < (candidate."createdAt", candidate.id)
        )
      ORDER BY candidate."createdAt" ASC, candidate.id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const id = rows[0]?.id;
    if (!id) return null;
    return tx.whatsAppJob.update({
      where: { id },
      data: { status: "PROCESSING", attempts: { increment: 1 }, lockedAt: new Date(), failedAt: null, errorCode: null },
    });
  });
}

async function loadJob(id: string) {
  return runAsDatabaseWorker("whatsapp_ai", (tx) => tx.whatsAppJob.findUnique({
    where: { id },
    include: {
      whatsappMessage: true,
      conversation: {
        include: {
          customerContact: true,
          messages: {
            orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
            take: 30,
            include: { attachments: true },
          },
        },
      },
      quoteRequest: true,
      quotation: { include: { supplierCompany: true } },
    },
  }));
}

async function completeJob(job: WhatsAppJob, telemetry?: { model: string; providerResponseIdHash: string; inputTokens?: number; outputTokens?: number }) {
  await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.whatsAppJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        lockedAt: null,
        model: telemetry?.model,
        providerResponseIdHash: telemetry?.providerResponseIdHash,
        inputTokens: telemetry?.inputTokens,
        outputTokens: telemetry?.outputTokens,
      },
    });
    await writeWhatsAppAudit(tx, {
      action: "WHATSAPP.JOB_COMPLETED",
      entityType: "WhatsAppJob",
      entityId: job.id,
      summary: "WhatsApp background job completed",
      metadata: { type: job.type, attempts: job.attempts },
    });
  });
}

async function failJob(job: WhatsAppJob, cause: unknown) {
  const code = errorCode(cause);
  const terminal = job.attempts >= MAX_ATTEMPTS
    || code === "OUTBOUND_DELIVERY_UNCERTAIN"
    || code === "META_PAID_TEMPLATE_DISABLED"
    || code === "META_QUOTE_TEMPLATE_REQUIRED"
    || code === "META_CONTACT_TEMPLATE_REQUIRED";
  await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.whatsAppJob.update({
      where: { id: job.id },
      data: terminal
        ? { status: "FAILED", failedAt: new Date(), lockedAt: null, errorCode: code }
        : { status: "PENDING", failedAt: new Date(), lockedAt: null, errorCode: code, availableAt: new Date(Date.now() + job.attempts * 30_000) },
    });
    if (terminal) {
      await writeWhatsAppSystemEvent(tx, "whatsapp_ai", {
        severity: "ERROR",
        code: "WHATSAPP_JOB_FAILED",
        message: "A WhatsApp background job exhausted its safe retry policy",
        context: { jobId: job.id, jobType: job.type, errorCode: code, attempts: job.attempts },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.JOB_FAILED",
        entityType: "WhatsAppJob",
        entityId: job.id,
        summary: "WhatsApp background job failed",
        metadata: { type: job.type, errorCode: code, attempts: job.attempts },
      });
      if (job.type === "PROCESS_INBOUND"
          && !["OUTBOUND_DELIVERY_UNCERTAIN", "META_PAID_TEMPLATE_DISABLED", "META_QUOTE_TEMPLATE_REQUIRED"].includes(code)) {
        await tx.whatsAppJob.upsert({
          where: { idempotencyKey: `intake-fallback:${job.id}` },
          create: {
            type: "SEND_INTAKE_FALLBACK",
            idempotencyKey: `intake-fallback:${job.id}`,
            conversationId: job.conversationId,
          },
          update: {},
        });
      }
    }
  });
}

async function sendReply(
  job: WhatsAppJob,
  conversation: LoadedJob["conversation"],
  body: string,
  options?: {
    outOfWindowTemplate?: { name: string; language: string; parameters: string[] };
    missingTemplateCode?: "META_QUOTE_TEMPLATE_REQUIRED" | "META_CONTACT_TEMPLATE_REQUIRED";
  },
) {
  if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
  const serviceWindowOpen = isServiceWindowOpen(conversation.messages);
  if (!serviceWindowOpen && !options?.outOfWindowTemplate) {
    throw new Error(options?.missingTemplateCode ?? "META_QUOTE_TEMPLATE_REQUIRED");
  }
  if (!serviceWindowOpen && !whatsappMessagingPolicy().allowPaidTemplates) {
    throw new Error("META_PAID_TEMPLATE_DISABLED");
  }
  const recentMessages = conversation.messages.flatMap((message) => message.bodyEncrypted
    ? [{
        direction: message.direction,
        status: message.status,
        occurredAt: message.occurredAt,
        body: decryptPrivateValue(message.bodyEncrypted),
      }]
    : []);
  if (wasReplyRecentlySent(recentMessages, body)) {
    await runAsDatabaseWorker("whatsapp_ai", (tx) => writeWhatsAppAudit(tx, {
      action: "WHATSAPP.REPLY_SUPPRESSED",
      entityType: "WhatsAppJob",
      entityId: job.id,
      summary: "A duplicate WhatsApp reply was suppressed",
      metadata: { conversationId: conversation.id },
    }));
    return;
  }

  const localMessageId = `queued:${job.id}`;
  const existing = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.whatsAppMessage.findUnique({
    where: { externalMessageId: localMessageId },
  }));
  if (existing && ["SENT", "DELIVERED", "READ"].includes(existing.status)) return;
  if (existing?.status === "QUEUED") throw new Error("OUTBOUND_DELIVERY_UNCERTAIN");

  const queued = await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    if (existing?.status === "FAILED") {
      const message = await tx.whatsAppMessage.update({
        where: { id: existing.id },
        data: {
          bodyEncrypted: encryptPrivateValue(body),
          status: "QUEUED",
          occurredAt: new Date(),
          failureCode: null,
          failureMessage: null,
        },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.MESSAGE_RETRY_QUEUED",
        entityType: "WhatsAppMessage",
        entityId: message.id,
        summary: "A definitively rejected WhatsApp reply was safely queued for retry",
        metadata: { jobId: job.id },
      });
      return message;
    }
    const message = await tx.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        externalMessageId: localMessageId,
        direction: "OUTBOUND",
        messageType: "TEXT",
        bodyEncrypted: encryptPrivateValue(body),
        status: "QUEUED",
        occurredAt: new Date(),
      },
    });
    await writeWhatsAppAudit(tx, {
      action: "WHATSAPP.MESSAGE_QUEUED",
      entityType: "WhatsAppMessage",
      entityId: message.id,
      summary: "Encrypted outbound WhatsApp reply queued",
      metadata: { jobId: job.id },
    });
    return message;
  });

  const recipient = decryptPrivateValue(conversation.customerContact.phoneEncrypted);
  try {
    const externalMessageId = serviceWindowOpen
      ? await sendMetaText(recipient, body)
      : await sendMetaTemplate({ to: recipient, ...options!.outOfWindowTemplate! });
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.whatsAppMessage.update({
        where: { id: queued.id },
        data: { externalMessageId, status: "SENT", occurredAt: new Date(), failureCode: null, failureMessage: null },
      });
      await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.MESSAGE_SENT",
        entityType: "WhatsAppMessage",
        entityId: queued.id,
        summary: "Outbound WhatsApp reply accepted by Meta",
        metadata: { jobId: job.id },
      });
    });
  } catch (error) {
    const code = errorCode(error);
    const definitivelyRejected = code.startsWith("META_HTTP_");
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.whatsAppMessage.updateMany({
        where: { id: queued.id, status: "QUEUED" },
        data: definitivelyRejected
          ? { status: "FAILED", failureCode: code, failureMessage: "Meta rejected outbound delivery" }
          : { failureCode: "OUTBOUND_DELIVERY_UNCERTAIN", failureMessage: "Outbound delivery could not be confirmed" },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.MESSAGE_SEND_FAILED",
        entityType: "WhatsAppMessage",
        entityId: queued.id,
        summary: "Outbound WhatsApp reply failed",
        metadata: { jobId: job.id, errorCode: definitivelyRejected ? code : "OUTBOUND_DELIVERY_UNCERTAIN" },
      });
    });
    if (!definitivelyRejected) throw new Error("OUTBOUND_DELIVERY_UNCERTAIN");
    throw error;
  }
}

async function persistMedia(message: LoadedJob["whatsappMessage"], conversationId: string) {
  if (!message?.mediaIdEncrypted) return { stored: false, rejected: false };
  const existing = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.attachment.findFirst({
    where: { whatsappMessageId: message.id },
  }));
  if (existing) return { stored: true, rejected: false, attachment: existing };
  if (message.messageType === "AUDIO") return { stored: false, rejected: true };

  const mediaId = decryptPrivateValue(message.mediaIdEncrypted);
  const hintedName = message.mediaFileNameEncrypted ? decryptPrivateValue(message.mediaFileNameEncrypted) : undefined;
  let downloaded: Awaited<ReturnType<typeof downloadMetaMedia>>;
  try {
    downloaded = await downloadMetaMedia(mediaId, hintedName);
  } catch (error) {
    if (["META_MEDIA_TYPE_REJECTED", "META_MEDIA_TOO_LARGE", "META_MEDIA_SIGNATURE_MISMATCH"].includes(errorCode(error))) {
      return { stored: false, rejected: true };
    }
    throw error;
  }
  const sha256 = createHash("sha256").update(downloaded.bytes).digest("hex");
  const sha256Base64 = createHash("sha256").update(downloaded.bytes).digest("base64");
  if (downloaded.providerSha256
      && downloaded.providerSha256.toLowerCase() !== sha256.toLowerCase()
      && downloaded.providerSha256 !== sha256Base64) {
    throw new Error("META_MEDIA_HASH_MISMATCH");
  }
  const storageKey = `customers/${conversationId}/messages/${message.id}/${randomUUID()}.${downloaded.extension}`;
  const storage = getSupabaseAdmin().storage.from(PRIVATE_BUCKET);
  const uploaded = await storage.upload(storageKey, downloaded.bytes, {
    contentType: downloaded.mimeType,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploaded.error) throw new Error("CUSTOMER_MEDIA_STORAGE_FAILED");
  try {
    const attachment = await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      const attachment = await tx.attachment.create({
        data: {
          kind: downloaded.mimeType.startsWith("image/") ? "PHOTO" : "DRAWING",
          fileName: downloaded.fileName,
          mimeType: downloaded.mimeType,
          byteSize: downloaded.bytes.byteLength,
          storageKey,
          sha256,
          scanStatus: "PENDING",
          whatsappMessageId: message.id,
        },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.MEDIA_STORED",
        entityType: "Attachment",
        entityId: attachment.id,
        summary: "Customer media stored privately and queued for security scanning",
        metadata: { messageId: message.id, mimeType: downloaded.mimeType, byteSize: downloaded.bytes.byteLength },
      });
      return attachment;
    });
    return { stored: true, rejected: false, attachment, bytes: downloaded.bytes };
  } catch (error) {
    await storage.remove([storageKey]).catch(() => undefined);
    throw error;
  }
}

function decryptAttachmentAnalysis(value: Uint8Array | null) {
  if (!value) return null;
  return quoteAttachmentAnalysisSchema.parse(JSON.parse(decryptPrivateValue(value)));
}

async function loadAttachmentBytes(storageKey: string) {
  const downloaded = await getSupabaseAdmin().storage.from(PRIVATE_BUCKET).download(storageKey);
  if (downloaded.error) throw new Error("CUSTOMER_MEDIA_STORAGE_READ_FAILED");
  return new Uint8Array(await downloaded.data.arrayBuffer());
}

async function ensureAttachmentAnalysis(
  attachment: Attachment,
  initialBytes: Uint8Array | undefined,
  safetyIdentifier: string,
) {
  const existing = decryptAttachmentAnalysis(attachment.aiSummaryEncrypted);
  if (existing) return existing;
  if (!["image/jpeg", "image/png", "application/pdf"].includes(attachment.mimeType)) return null;
  const bytes = initialBytes ?? await loadAttachmentBytes(attachment.storageKey);
  const { result, telemetry } = await analyzeQuoteAttachment({
    fileName: attachment.fileName,
    mimeType: attachment.mimeType as "image/jpeg" | "image/png" | "application/pdf",
    bytes,
    safetyIdentifier,
  });
  await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.attachment.update({
      where: { id: attachment.id },
      data: {
        aiSummaryEncrypted: encryptPrivateValue(JSON.stringify(result)),
        aiAnalyzedAt: new Date(),
        aiAnalysisModel: telemetry.model,
        aiResponseIdHash: telemetry.providerResponseIdHash,
      },
    });
    await writeWhatsAppAudit(tx, {
      action: "WHATSAPP.MEDIA_ANALYSED",
      entityType: "Attachment",
      entityId: attachment.id,
      summary: "A private customer attachment was analysed for quote requirements",
      metadata: {
        model: telemetry.model,
        usefulForQuote: result.usefulForQuote,
        needsHumanReview: result.needsHumanReview,
        inputTokens: telemetry.inputTokens,
        outputTokens: telemetry.outputTokens,
      },
    });
  });
  return result;
}

function attachmentContext(fileName: string, analysis: QuoteAttachmentAnalysis) {
  const facts = analysis.facts.length ? ` Facts: ${analysis.facts.join("; ")}` : "";
  return `[Customer attachment ${JSON.stringify(fileName)}: ${analysis.summary}${facts}]`;
}

function decryptDraft(value: Uint8Array | null) {
  if (!value) return null;
  return quoteDraftSchema.parse(JSON.parse(decryptPrivateValue(value)));
}

function consentReply() {
  const origin = process.env.APP_URL?.trim();
  const privacyUrl = origin ? `${applicationOrigin(origin)}/legal/privacy` : "/legal/privacy";
  return [
    "Hi 👋 I’m Bridge AI, your quotation assistant from Ironbridge Group Ltd.",
    "I’ll help turn your details, photos, drawings or PDFs into a clear request for approved suppliers, then bring their prices and lead times back here.",
    "Your contact details stay private until you accept a quote and the selected supplier completes the secure unlock payment.",
    `Privacy: ${privacyUrl}`,
    "Reply CONTINUE to proceed, or STOP to end.",
  ].join("\n\n");
}

export function isConsent(value: string) {
  return /^(continue|i agree|agree)$/i.test(value.trim());
}

export function isStop(value: string) {
  return /^(stop|cancel|end|unsubscribe)$/i.test(value.trim());
}

export function isConfirmation(value: string) {
  return /^confirm$/i.test(value.trim());
}

export function formatConfirmation(draft: QuoteDraft, categoryName: string, attachmentCount = 0) {
  const items = draft.items.map((item, index) => `${index + 1}. ${item.quantity} ${item.unit} — ${item.description}`).join("\n");
  return [
    "Great — here’s the job I’ll send to suitable approved suppliers:",
    `Project: ${draft.title}`,
    `Category: ${categoryName}`,
    `Delivery: ${draft.deliveryPostcode}`,
    `Requirements: ${draft.summary}`,
    items,
    attachmentCount > 0
      ? `Files: ${attachmentCount} received securely and added to this job`
      : "For the most accurate pricing, send a photo, drawing or PDF now if you have one. You can still continue without a file.",
    draft.customerBudget === null ? null : `Budget: £${draft.customerBudget.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`,
    "Reply CONFIRM to send it, or tell me what to change.",
  ].filter(Boolean).join("\n\n");
}

export function draftIsComplete(draft: QuoteDraft) {
  return Boolean(draft.deliveryPostcode && draft.categorySlug && draft.title && draft.summary && draft.items.length > 0);
}

async function createQuoteRequest(job: WhatsAppJob, loaded: LoadedJob, draft: QuoteDraft) {
  if (!loaded.conversation) throw new Error("CONVERSATION_NOT_FOUND");
  const confirmationMessage = loaded.whatsappMessage;
  if (!confirmationMessage) throw new Error("CONFIRMATION_MESSAGE_NOT_FOUND");
  const category = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.productCategory.findUnique({
    where: { slug: draft.categorySlug ?? "" }, select: { id: true, name: true, active: true },
  }));
  if (!category?.active || !draftIsComplete(draft)) throw new Error("QUOTE_DRAFT_INCOMPLETE");
  const delivery = await lookupPostcode(draft.deliveryPostcode!);
  const now = new Date();
  const { quoteResponseHours, distributionLimit } = whatsappConciergeConfig();
  const reference = `BA-${now.getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`;
  return runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    const existing = await tx.quoteRequest.findUnique({
      where: { customerConfirmationMessageId: confirmationMessage.id },
    });
    if (existing) {
      await tx.conversation.update({
        where: { id: loaded.conversation!.id },
        data: { aiStage: "QUOTE_CREATED" },
      });
      const assignmentCount = await tx.supplierAssignment.count({
        where: { quoteRequestId: existing.id, status: { not: "WITHDRAWN" } },
      });
      return { request: existing, assignmentCount };
    }
    const request = await tx.quoteRequest.create({
      data: {
        reference,
        conversationId: loaded.conversation!.id,
        customerConfirmationMessageId: confirmationMessage.id,
        customerContactId: loaded.conversation!.customerContactId,
        categoryId: category.id,
        title: draft.title!,
        summary: draft.summary!,
        deliveryPostcode: delivery.postcode,
        deliveryLatitude: delivery.latitude,
        deliveryLongitude: delivery.longitude,
        customerBudget: draft.customerBudget,
        status: "OPEN",
        distributionLimit,
        responseDueAt: addSupplierResponseHours(now, quoteResponseHours),
        publishedAt: now,
        items: { create: draft.items.map((item, index) => ({ ...item, displayOrder: index })) },
      },
    });
    const linkedAttachments = await tx.attachment.updateMany({
      where: {
        quoteRequestId: null,
        whatsappMessage: {
          conversationId: loaded.conversation!.id,
          occurredAt: { gte: loaded.conversation!.aiSessionStartedAt },
        },
      },
      data: { quoteRequestId: request.id },
    });
    const matches = await findSupplierMatches(
      tx,
      request,
      {
        postcode: delivery.postcode,
        latitude: delivery.latitude,
        longitude: delivery.longitude,
      },
      { limit: Math.min(distributionLimit, 5) },
    );
    const assignedSupplierIds: string[] = [];
    for (const match of matches) {
      const assignment = await tx.supplierAssignment.create({
        data: {
          quoteRequestId: request.id,
          supplierCompanyId: match.id,
          status: "PENDING",
          expiresAt: request.responseDueAt,
          assignedById: null,
        },
      });
      assignedSupplierIds.push(assignment.supplierCompanyId);
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.REQUEST_AUTO_ASSIGNED",
        entityType: "SupplierAssignment",
        entityId: assignment.id,
        summary: "Confirmed WhatsApp request automatically assigned to an eligible supplier",
        metadata: {
          quoteRequestId: request.id,
          supplierCompanyId: match.id,
          coverageType: match.match.type,
          coverageLabel: match.match.label,
          responseDueAt: request.responseDueAt.toISOString(),
        },
      });
    }
    if (assignedSupplierIds.length > 0) {
      const members = await tx.supplierTeamMembership.findMany({
        where: { supplierCompanyId: { in: assignedSupplierIds }, status: "ACTIVE" },
        select: { userId: true, supplierCompanyId: true },
      });
      const disabledPreferences = await tx.notificationPreference.findMany({
        where: { supplierCompanyId: { in: assignedSupplierIds }, inAppEnabled: false },
        select: { userId: true, supplierCompanyId: true },
      });
      const disabled = new Set(disabledPreferences.map((item) => `${item.userId}:${item.supplierCompanyId}`));
      const recipients = members.filter((item) => !disabled.has(`${item.userId}:${item.supplierCompanyId}`));
      if (recipients.length > 0) {
        await tx.notification.createMany({
          data: recipients.map((member) => ({
            userId: member.userId,
            supplierCompanyId: member.supplierCompanyId,
            type: "NEW_QUOTE_REQUEST" as const,
            channel: "IN_APP" as const,
            title: `New quote request ${request.reference}`,
            body: `${request.title} is available for review until the recorded response deadline.`,
            actionUrl: `/dashboard/requests/${request.reference}`,
          })),
        });
      }
      await tx.quoteRequest.update({
        where: { id: request.id },
        data: { status: "MATCHING" },
      });
    }
    await tx.conversation.update({
      where: { id: loaded.conversation!.id },
      data: {
        aiStage: "QUOTE_CREATED",
        aiLastQuestionKey: null,
        aiUnproductiveTurns: 0,
      },
    });
    await writeWhatsAppAudit(tx, {
      action: "WHATSAPP.QUOTE_REQUEST_CREATED",
      entityType: "QuoteRequest",
      entityId: request.id,
      summary: "Customer-confirmed WhatsApp quote request created",
      metadata: {
        jobId: job.id,
        reference,
        categoryId: category.id,
        itemCount: draft.items.length,
        attachmentCount: linkedAttachments.count,
        distributionLimit,
        automaticAssignmentCount: assignedSupplierIds.length,
      },
    });
    return { request, assignmentCount: assignedSupplierIds.length };
  });
}

async function hasNewerInboundJob(job: WhatsAppJob) {
  return runAsDatabaseWorker("whatsapp_ai", (tx) => tx.whatsAppJob.findFirst({
    where: {
      conversationId: job.conversationId,
      type: "PROCESS_INBOUND",
      status: "PENDING",
      OR: [
        { createdAt: { gt: job.createdAt } },
        { createdAt: job.createdAt, id: { gt: job.id } },
      ],
    },
    select: { id: true },
  }));
}

function quoteRequestStatus(status: string, submittedQuotes: number) {
  if (status === "WON") return "accepted";
  if (status === "LOST") return "not selected";
  if (status === "EXPIRED") return "expired";
  if (status === "CANCELLED") return "cancelled";
  if (submittedQuotes > 0) return `${submittedQuotes} quote${submittedQuotes === 1 ? "" : "s"} ready`;
  return "waiting for quotes";
}

async function quoteHistoryReply(conversation: LoadedJob["conversation"]) {
  if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
  const requests = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.quoteRequest.findMany({
    where: { customerContactId: conversation.customerContactId },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      quotations: {
        where: { status: { in: ["SUBMITTED", "SELECTED_PENDING_PAYMENT", "ACCEPTED"] } },
        select: { id: true },
      },
    },
  }));
  const draft = decryptDraft(conversation.aiDraftEncrypted);
  if (!requests.length) {
    return [
      "You do not have any submitted quote requests yet.",
      draft?.title ? `Your unsent draft is still saved: ${draft.title}.` : null,
      "Reply NEW QUOTE to start a fresh request.",
    ].filter(Boolean).join("\n\n");
  }
  const lines = requests.map((request, index) => (
    `${index + 1}. ${request.reference} — ${request.title} — ${quoteRequestStatus(request.status, request.quotations.length)}`
  ));
  return [
    "Your recent quote requests:",
    lines.join("\n"),
    draft?.title ? `Unsent draft: ${draft.title}.` : null,
    "Reply NEW QUOTE to start another request. For the latest supplier prices on your active request, reply QUOTES.",
  ].filter(Boolean).join("\n\n");
}

async function startNewQuote(
  job: WhatsAppJob,
  conversation: NonNullable<LoadedJob["conversation"]>,
  inbound: NonNullable<LoadedJob["whatsappMessage"]>,
  announce = true,
) {
  // Keep details from messages such as “another quote for aluminium bifolds”
  // inside the new session so the customer never has to type them twice.
  const startedAt = inbound.occurredAt;
  const updated = await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    const next = await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        aiStage: "COLLECTING",
        aiSessionStartedAt: startedAt,
        aiDraftEncrypted: null,
        aiDraftFingerprint: null,
        aiLastQuestionKey: null,
        aiUnproductiveTurns: 0,
        aiLastProgressAt: startedAt,
        closedAt: null,
      },
      include: {
        customerContact: true,
        messages: {
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          take: 30,
          include: { attachments: true },
        },
      },
    });
    await writeWhatsAppAudit(tx, {
      action: "WHATSAPP.NEW_QUOTE_STARTED",
      entityType: "Conversation",
      entityId: conversation.id,
      summary: "Customer started a fresh WhatsApp quote intake session",
      metadata: { messageId: inbound.id, previousStage: conversation.aiStage, startedAt: startedAt.toISOString() },
    });
    return next;
  });
  if (announce) {
    await sendReply(job, updated, "Brilliant — let’s price another job. What product do you need? You can type the details or send a photo, drawing or PDF.");
  }
  return updated;
}

async function processInbound(job: WhatsAppJob, loaded: LoadedJob) {
  const initialConversation = loaded.conversation;
  const inbound = loaded.whatsappMessage;
  if (!initialConversation || !inbound || inbound.direction !== "INBOUND") throw new Error("INBOUND_JOB_INVALID");
  let conversation: NonNullable<LoadedJob["conversation"]> = initialConversation;
  const text = inbound.bodyEncrypted ? decryptPrivateValue(inbound.bodyEncrypted) : "";

  const controlMessage = isStop(text)
    || isConsent(text)
    || isConfirmation(text)
    || isQuoteRefresh(text)
    || isNewQuoteRequest(text)
    || isQuoteHistoryRequest(text)
    || isMenuRequest(text)
    || /^accept\s+[1-5]$/i.test(text.trim());
  if (!controlMessage && await hasNewerInboundJob(job)) {
    return undefined;
  }

  if (isStop(text)) {
    await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.conversation.update({
      where: { id: conversation.id },
      data: {
        aiStage: "CLOSED",
        closedAt: new Date(),
        aiDraftEncrypted: null,
        aiDraftFingerprint: null,
        aiLastQuestionKey: null,
        aiUnproductiveTurns: 0,
      },
    }));
    await sendReply(job, conversation, "Your Bridge AI conversation is closed. We will not create a quote request from it.");
    return undefined;
  }

  if (!conversation.aiConsentAt) {
    if (!isConsent(text)) {
      await sendReply(job, conversation, consentReply());
      return undefined;
    }
    const consentedAt = new Date();
    const consentedConversation = await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      const updated = await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          aiConsentAt: consentedAt,
          aiSessionStartedAt: consentedAt,
          aiStage: "COLLECTING",
          aiDraftFingerprint: null,
          aiLastQuestionKey: null,
          aiUnproductiveTurns: 0,
          aiLastProgressAt: consentedAt,
          closedAt: null,
        },
        include: {
          customerContact: true,
          messages: {
            orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
            take: 30,
            include: { attachments: true },
          },
        },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.AI_CONSENT_RECORDED",
        entityType: "Conversation",
        entityId: conversation.id,
        summary: "Customer consented to automated WhatsApp quote intake",
        metadata: { messageId: inbound.id },
      });
      return updated;
    });
    await sendReply(job, consentedConversation, "Perfect — what are you pricing today? For example, uPVC windows, aluminium bifolds, a composite door or a roof lantern. You can also send a photo, drawing or PDF.");
    return undefined;
  }

  if (isNewQuoteRequest(text)) {
    const includesJobDetails = newQuoteDetails(text) !== null || Boolean(inbound.mediaIdEncrypted);
    conversation = await startNewQuote(job, conversation, inbound, !includesJobDetails);
    if (!includesJobDetails) return undefined;
  }

  if (isQuoteHistoryRequest(text)) {
    await sendReply(job, conversation, await quoteHistoryReply(conversation));
    return undefined;
  }

  if (isMenuRequest(text)) {
    await sendReply(job, conversation, quoteMenu(Boolean(conversation.aiDraftEncrypted)));
    return undefined;
  }

  const mediaMessages = conversation.messages
    .filter((message) => message.mediaIdEncrypted
      && message.direction === "INBOUND"
      && message.occurredAt >= conversation.aiSessionStartedAt)
    .slice(0, 10);
  let rejectedMedia = false;
  let currentAttachmentCount = 0;
  const attachmentAnalyses: QuoteAttachmentAnalysis[] = [];
  for (const message of mediaMessages) {
    const outcome = await persistMedia(message, conversation.id);
    rejectedMedia ||= outcome.rejected;
    if (outcome.attachment) {
      if (message.id === inbound.id) currentAttachmentCount += 1;
      const analysis = await ensureAttachmentAnalysis(
        outcome.attachment,
        outcome.bytes,
        conversation.customerContact.phoneHash,
      );
      if (analysis) attachmentAnalyses.push(analysis);
    }
  }

  const refreshed = await loadJob(job.id);
  if (!refreshed?.conversation) throw new Error("CONVERSATION_NOT_FOUND");
  const stage = refreshed.conversation.aiStage;
  const draft = decryptDraft(refreshed.conversation.aiDraftEncrypted);

  if (attachmentAnalyses.some((analysis) => analysis.needsHumanReview)) {
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.conversation.update({ where: { id: refreshed.conversation!.id }, data: { aiStage: "HUMAN_REVIEW" } });
      await writeWhatsAppSystemEvent(tx, "whatsapp_ai", {
        severity: "WARNING",
        code: "CUSTOMER_ATTACHMENT_REVIEW",
        message: "A WhatsApp attachment requires administrator review",
        context: { conversationId: refreshed.conversation!.id, jobId: job.id },
      });
    });
    await sendReply(job, refreshed.conversation, "I’ve received your file, but it needs a Bridge AI administrator to review it before the quote request can continue.");
    return undefined;
  }

  if (stage === "AWAITING_CONFIRMATION" && isConfirmation(text)) {
    if (!draft) throw new Error("QUOTE_DRAFT_MISSING");
    let request;
    try {
      request = await createQuoteRequest(job, refreshed, draft);
    } catch (error) {
      if (!(error instanceof PostcodeLookupError) || error.code === "GEOCODING_UNAVAILABLE") throw error;
      const correctedDraft = { ...draft, deliveryPostcode: null };
      await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
        await tx.conversation.update({
          where: { id: refreshed.conversation!.id },
          data: {
            aiStage: "COLLECTING",
            aiDraftEncrypted: encryptPrivateValue(JSON.stringify(correctedDraft)),
            aiDraftFingerprint: quoteDraftFingerprint(correctedDraft),
            aiLastQuestionKey: "DELIVERY_POSTCODE",
            aiUnproductiveTurns: 0,
          },
        });
        await writeWhatsAppAudit(tx, {
          action: "WHATSAPP.POSTCODE_REJECTED",
          entityType: "Conversation",
          entityId: refreshed.conversation!.id,
          summary: "Customer confirmation was paused for a valid delivery postcode",
          metadata: { jobId: job.id, messageId: inbound.id, errorCode: error.code },
        });
      });
      await sendReply(job, refreshed.conversation, "I couldn’t match that postcode. What is the full UK delivery postcode? For example, GL52 6TD.");
      return undefined;
    }
    const distributionMessage = request.assignmentCount > 0
      ? `It has been sent to ${request.assignmentCount} approved supplier${request.assignmentCount === 1 ? "" : "s"}.`
      : "It is safely recorded and awaiting an eligible supplier match. A Bridge AI administrator can review the distribution.";
    await sendReply(job, refreshed.conversation, `Perfect — request ${request.request.reference} is live. ${distributionMessage} I’ll bring the available prices and lead times back here while keeping identities private. Reply QUOTES for an update, or NEW QUOTE whenever you have another job to price.`);
    return undefined;
  }

  if (isQuoteRefresh(text) && ["QUOTE_CREATED", "AWAITING_SELECTION"].includes(stage)) {
    const summary = await currentQuoteSummary(refreshed.conversation.id);
    if (!summary) {
      await sendReply(job, refreshed.conversation, "No supplier quotes are available yet. I’ll send the first price update here; you can reply QUOTES again whenever you want the latest list.");
      return undefined;
    }
    await sendReply(job, refreshed.conversation, summary.body);
    await markQuotesPresented(job, refreshed.conversation.id, summary.requestId, summary.quoteCount, "WHATSAPP.QUOTE_SUMMARY_REQUESTED");
    return undefined;
  }

  if (stage === "AWAITING_SELECTION") {
    const match = /^accept\s+([1-5])$/i.exec(text.trim());
    if (!match) {
      await sendReply(job, refreshed.conversation, "To choose a quote, reply ACCEPT followed by its number, for example ACCEPT 1.");
      return undefined;
    }
    const request = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.quoteRequest.findFirst({
      where: { conversationId: refreshed.conversation!.id, status: { in: ["OPEN", "MATCHING", "QUOTED"] } },
      orderBy: { createdAt: "desc" },
      include: { quotations: { where: { status: "SUBMITTED" }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 5 } },
    }));
    const selected = request?.quotations[Number(match[1]) - 1];
    if (!selected) {
      await sendReply(job, refreshed.conversation, "That quote number is not available. Please choose one of the numbers in the latest quote list.");
      return undefined;
    }
    await selectQuotationForCustomer({ quotationId: selected.id, evidence: `WhatsApp message ${inbound.externalMessageId}` });
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.conversation.update({ where: { id: refreshed.conversation!.id }, data: { aiStage: "SELECTION_RECORDED" } });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.QUOTE_SELECTED",
        entityType: "SupplierQuotation",
        entityId: selected.id,
        summary: "Customer selected an anonymised quote through WhatsApp",
        metadata: { messageId: inbound.id, quoteRequestId: request!.id, displayedPosition: Number(match[1]) },
      });
    });
    await sendReply(job, refreshed.conversation, "Your choice is recorded. The supplier has been asked to pay the £25 success fee. Contact details remain private until payment is verified.");
    return undefined;
  }

  if (["QUOTE_CREATED", "SELECTION_RECORDED", "CLOSED"].includes(stage)) {
    await sendReply(job, refreshed.conversation, stage === "QUOTE_CREATED"
      ? "This request is live and safely stored. I’ll message you when supplier prices and lead times are ready. Reply NEW QUOTE to price another job, or MY QUOTES to see your recent requests."
      : "This quote is complete. Reply NEW QUOTE to price another job, or MY QUOTES to see your recent requests.");
    return undefined;
  }

  const categories = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.productCategory.findMany({
    where: { active: true }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { slug: true, name: true, description: true }, take: 100,
  }));
  if (!categories.length) throw new Error("NO_PRODUCT_CATEGORIES");
  const messages = refreshed.conversation.messages
    .slice()
    .reverse()
    .filter((message) => message.occurredAt >= refreshed.conversation!.aiSessionStartedAt)
    .filter((message) => message.direction === "INBOUND" || ["SENT", "DELIVERED", "READ"].includes(message.status))
    .flatMap((message) => {
      const parts: Array<{ direction: "INBOUND" | "OUTBOUND"; text: string }> = [];
      if (message.bodyEncrypted) {
        parts.push({ direction: message.direction, text: decryptPrivateValue(message.bodyEncrypted) });
      }
      for (const attachment of message.attachments) {
        const analysis = decryptAttachmentAnalysis(attachment.aiSummaryEncrypted);
        if (analysis) parts.push({ direction: message.direction, text: attachmentContext(attachment.fileName, analysis) });
      }
      if (message.mediaIdEncrypted && !message.attachments.length) {
        parts.push({ direction: message.direction, text: `[Customer uploaded a ${message.messageType.toLowerCase()} file that is being processed.]` });
      }
      return parts;
    });
  const { result, telemetry } = await extractQuoteIntake({
    messages,
    currentDraft: draft,
    categories,
    safetyIdentifier: refreshed.conversation.customerContact.phoneHash,
  });
  if (result.draft.deliveryPostcode) {
    try {
      const delivery = await lookupPostcode(result.draft.deliveryPostcode);
      result.draft.deliveryPostcode = delivery.postcode;
    } catch (error) {
      if (!(error instanceof PostcodeLookupError) || error.code === "GEOCODING_UNAVAILABLE") throw error;
      result.draft.deliveryPostcode = null;
      result.readyForConfirmation = false;
      result.nextQuestionKey = "DELIVERY_POSTCODE";
      result.reply = "I couldn’t match that postcode. What is the full UK delivery postcode? For example, GL52 6TD.";
    }
  }
  if (result.needsHumanReview) {
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.conversation.update({ where: { id: refreshed.conversation!.id }, data: { aiStage: "HUMAN_REVIEW", aiDraftEncrypted: encryptPrivateValue(JSON.stringify(result.draft)) } });
      await writeWhatsAppSystemEvent(tx, "whatsapp_ai", { severity: "WARNING", code: "CUSTOMER_CONVERSATION_REVIEW", message: "A WhatsApp conversation requires administrator review", context: { conversationId: refreshed.conversation!.id, jobId: job.id } });
    });
    await sendReply(job, refreshed.conversation, "I can’t safely complete this request automatically. A Bridge AI administrator will need to review it.");
    return telemetry;
  }
  const questionKey = requiredQuestionKey(result.draft, result.nextQuestionKey);
  const ready = result.readyForConfirmation && questionKey === "NONE" && draftIsComplete(result.draft);
  const fingerprint = quoteDraftFingerprint(result.draft);
  const progress = conversationProgress({
    previousFingerprint: refreshed.conversation.aiDraftFingerprint,
    previousQuestionKey: refreshed.conversation.aiLastQuestionKey,
    previousUnproductiveTurns: refreshed.conversation.aiUnproductiveTurns,
    currentFingerprint: fingerprint,
    currentQuestionKey: ready ? "NONE" : questionKey,
  });
  if (!ready && progress.needsHumanReview) {
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.conversation.update({
        where: { id: refreshed.conversation!.id },
        data: {
          aiStage: "HUMAN_REVIEW",
          aiDraftEncrypted: encryptPrivateValue(JSON.stringify(result.draft)),
          aiDraftFingerprint: fingerprint,
          aiLastQuestionKey: questionKey,
          aiUnproductiveTurns: progress.unproductiveTurns,
        },
      });
      await writeWhatsAppSystemEvent(tx, "whatsapp_ai", {
        severity: "WARNING",
        code: "CUSTOMER_INTAKE_STALLED",
        message: "A WhatsApp quote intake stopped making safe progress",
        context: { conversationId: refreshed.conversation!.id, jobId: job.id, questionKey },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.INTAKE_ESCALATED",
        entityType: "Conversation",
        entityId: refreshed.conversation!.id,
        summary: "Stalled WhatsApp quote intake escalated for administrator review",
        metadata: { jobId: job.id, questionKey, unproductiveTurns: progress.unproductiveTurns },
      });
    });
    await sendReply(job, refreshed.conversation, "I’m sorry, I can’t safely interpret that detail without risking an incorrect quote request. I’ve paused this enquiry for a Bridge AI administrator to review.");
    return telemetry;
  }
  const category = result.draft.categorySlug ? categories.find((item) => item.slug === result.draft.categorySlug) : undefined;
  await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.conversation.update({
      where: { id: refreshed.conversation!.id },
      data: {
        aiStage: ready ? "AWAITING_CONFIRMATION" : "COLLECTING",
        aiDraftEncrypted: encryptPrivateValue(JSON.stringify(result.draft)),
        aiDraftFingerprint: fingerprint,
        aiLastQuestionKey: ready ? null : questionKey,
        aiUnproductiveTurns: ready ? 0 : progress.unproductiveTurns,
        aiLastProgressAt: progress.progressed ? new Date() : undefined,
      },
    });
    await writeWhatsAppAudit(tx, {
      action: "WHATSAPP.AI_DRAFT_UPDATED",
      entityType: "Conversation",
      entityId: refreshed.conversation!.id,
      summary: "Encrypted WhatsApp quote draft updated",
      metadata: {
        jobId: job.id,
        readyForConfirmation: ready,
        itemCount: result.draft.items.length,
        questionKey: ready ? "NONE" : questionKey,
        progressed: progress.progressed,
        unproductiveTurns: progress.unproductiveTurns,
      },
    });
  });
  const attachmentCount = refreshed.conversation.messages
    .filter((message) => message.occurredAt >= refreshed.conversation!.aiSessionStartedAt)
    .reduce((count, message) => count + message.attachments.length, 0);
  const mediaAcknowledgement = currentAttachmentCount > 0
    ? `\n\nGreat — I’ve securely received and read ${currentAttachmentCount === 1 ? "that file" : `those ${currentAttachmentCount} files`} and added the useful details.`
    : "";
  const repeatedClarification = !ready && progress.repeatedQuestion && !progress.progressed
    ? repeatClarification(questionKey)
    : null;
  const reply = ready && category
      ? formatConfirmation(result.draft, category.name, attachmentCount)
      : `${repeatedClarification ?? result.reply}${mediaAcknowledgement}${rejectedMedia ? "\n\nOne uploaded file could not be accepted. Please send a genuine JPG, PNG or PDF within the size limit." : ""}`;
  await sendReply(job, refreshed.conversation, reply);
  return telemetry;
}

function formatPrice(value: Prisma.Decimal, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(value));
}

async function currentQuoteSummary(conversationId: string) {
  const request = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.quoteRequest.findFirst({
    where: { conversationId, status: { in: ["OPEN", "MATCHING", "QUOTED"] } },
    orderBy: { createdAt: "desc" },
    include: { quotations: { where: { status: "SUBMITTED" }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 5 } },
  }));
  if (!request) return null;
  const quotes = request.quotations.filter((quote) => !quote.validUntil || quote.validUntil > new Date());
  if (!quotes.length) return null;
  const lines = quotes.map((quote, index) => `Quote ${index + 1}: ${formatPrice(quote.price, quote.currency)} — lead time ${quote.leadTimeDays} day${quote.leadTimeDays === 1 ? "" : "s"}`);
  return {
    requestId: request.id,
    reference: request.reference,
    quoteCount: quotes.length,
    lines,
    body: [
      `Current prices for ${request.reference}. Supplier identities remain private:`,
      lines.join("\n"),
      "Reply ACCEPT followed by the quote number, for example ACCEPT 1. Contact details remain locked until the selected supplier pays the £25 success fee.",
    ].join("\n\n"),
  };
}

async function markQuotesPresented(
  job: WhatsAppJob,
  conversationId: string,
  requestId: string,
  quoteCount: number,
  action = "WHATSAPP.QUOTE_SUMMARY_SENT",
) {
  await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.conversation.update({ where: { id: conversationId }, data: { aiStage: "AWAITING_SELECTION" } });
    await tx.quoteRequest.updateMany({ where: { id: requestId, status: { in: ["OPEN", "MATCHING"] } }, data: { status: "QUOTED" } });
    await writeWhatsAppAudit(tx, {
      action,
      entityType: "QuoteRequest",
      entityId: requestId,
      summary: action === "WHATSAPP.QUOTE_SUMMARY_SENT"
        ? "Anonymised supplier prices and lead times sent to customer"
        : "Customer requested the latest anonymised supplier prices and lead times",
      metadata: { jobId: job.id, quoteCount },
    });
  });
}

async function processQuoteSummary(job: WhatsAppJob, loaded: LoadedJob) {
  if (!loaded.conversation || !loaded.quoteRequest || !loaded.quotation) throw new Error("QUOTE_SUMMARY_JOB_INVALID");
  const summary = await currentQuoteSummary(loaded.conversation.id);
  if (!summary || summary.requestId !== loaded.quoteRequest.id) return undefined;
  const template = metaQuoteTemplate();
  await sendReply(job, loaded.conversation, summary.body, template ? {
    outOfWindowTemplate: {
      ...template,
      parameters: [summary.reference, summary.lines.join("\n")],
    },
  } : undefined);
  await markQuotesPresented(job, loaded.conversation.id, summary.requestId, summary.quoteCount);
  return undefined;
}

async function processContactUnlock(job: WhatsAppJob, loaded: LoadedJob) {
  if (!loaded.conversation || !loaded.quoteRequest || !loaded.quotation) throw new Error("CONTACT_UNLOCK_JOB_INVALID");
  const grant = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.contactAccessGrant.findUnique({
    where: { quotationId: loaded.quotation!.id },
    include: { successFee: true },
  }));
  if (!grant || grant.successFee.status !== "PAID" || grant.revokedAt) throw new Error("CONTACT_UNLOCK_NOT_AUTHORISED");
  const supplier = loaded.quotation.supplierCompany;
  const supplierName = supplier.tradingName ?? supplier.legalName;
  const body = [
    `Payment is verified for ${loaded.quoteRequest.reference}. You and the selected supplier can now contact each other.`,
    `Supplier: ${supplierName}`,
    `Email: ${supplier.contactEmail}`,
    `Phone: ${supplier.contactPhone}`,
    "Use these details only for this enquiry. Bridge AI does not take card or bank details in WhatsApp.",
  ].join("\n\n");
  await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.contactAccessGrant.update({
    where: { id: grant.id }, data: { notificationAttemptedAt: new Date(), notificationFailureCode: null },
  }));
  try {
    const template = metaContactTemplate();
    await sendReply(job, loaded.conversation, body, {
      missingTemplateCode: "META_CONTACT_TEMPLATE_REQUIRED",
      outOfWindowTemplate: template ? {
        ...template,
        parameters: [loaded.quoteRequest.reference, supplierName, supplier.contactEmail, supplier.contactPhone],
      } : undefined,
    });
  } catch (error) {
    await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.contactAccessGrant.update({
      where: { id: grant.id }, data: { notificationFailureCode: errorCode(error) },
    }));
    throw error;
  }
  await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.contactAccessGrant.update({
      where: { id: grant.id }, data: { customerNotifiedAt: new Date(), notificationFailureCode: null },
    });
    await writeWhatsAppAudit(tx, {
      action: "WHATSAPP.CONTACT_DETAILS_RELEASED",
      entityType: "ContactAccessGrant",
      entityId: grant.id,
      summary: "Selected supplier contact details sent after verified payment",
      metadata: { jobId: job.id, quoteRequestId: loaded.quoteRequest!.id, quotationId: loaded.quotation!.id },
    });
  });
  return undefined;
}

async function processIntakeFallback(job: WhatsAppJob, loaded: LoadedJob) {
  if (!loaded.conversation) throw new Error("INTAKE_FALLBACK_INVALID");
  await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.conversation.update({
      where: { id: loaded.conversation!.id },
      data: { aiStage: "HUMAN_REVIEW" },
    });
    await writeWhatsAppSystemEvent(tx, "whatsapp_ai", {
      severity: "ERROR",
      code: "CUSTOMER_INTAKE_FALLBACK",
      message: "A customer was notified that automated WhatsApp intake needs human review",
      context: { conversationId: loaded.conversation!.id, jobId: job.id },
    });
    await writeWhatsAppAudit(tx, {
      action: "WHATSAPP.INTAKE_FALLBACK_QUEUED",
      entityType: "Conversation",
      entityId: loaded.conversation!.id,
      summary: "Terminal WhatsApp intake failure moved to human review",
      metadata: { jobId: job.id },
    });
  });
  await sendReply(
    job,
    loaded.conversation,
    "I’ve received your latest message securely, but I can’t process it reliably right now. I’ve paused the enquiry for a Bridge AI administrator to review so none of your information is lost.",
  );
  return undefined;
}

async function processJob(job: WhatsAppJob) {
  const loaded = await loadJob(job.id);
  if (!loaded) throw new Error("JOB_NOT_FOUND");
  if (job.type === "PROCESS_INBOUND") return processInbound(job, loaded);
  if (job.type === "SEND_INTAKE_FALLBACK") return processIntakeFallback(job, loaded);
  if (job.type === "SEND_QUOTE_SUMMARY") return processQuoteSummary(job, loaded);
  if (job.type === "SEND_CONTACT_UNLOCK") return processContactUnlock(job, loaded);
  throw new Error("JOB_TYPE_UNSUPPORTED");
}

export async function enqueueQuoteSummary(quotationId: string) {
  return runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    const quotation = await tx.supplierQuotation.findUnique({
      where: { id: quotationId }, include: { quoteRequest: true },
    });
    if (!quotation?.quoteRequest.conversationId || quotation.status !== "SUBMITTED") return null;
    const idempotencyKey = `quote-summary:${quotation.quoteRequestId}:first`;
    const created = await tx.whatsAppJob.createMany({
      data: [{
        type: "SEND_QUOTE_SUMMARY",
        idempotencyKey,
        conversationId: quotation.quoteRequest.conversationId,
        quoteRequestId: quotation.quoteRequestId,
        quotationId: quotation.id,
      }],
      skipDuplicates: true,
    });
    if (!created.count) return null;
    return tx.whatsAppJob.findUnique({ where: { idempotencyKey } });
  });
}

export async function enqueueContactUnlock(successFeeId: string) {
  return runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    const fee = await tx.supplierSuccessFee.findUnique({
      where: { id: successFeeId },
      include: { quoteRequest: true, quotation: true },
    });
    if (!fee || fee.status !== "PAID" || !fee.quoteRequest.conversationId) return null;
    return tx.whatsAppJob.upsert({
      where: { idempotencyKey: `contact-unlock:${fee.id}` },
      create: {
        type: "SEND_CONTACT_UNLOCK",
        idempotencyKey: `contact-unlock:${fee.id}`,
        conversationId: fee.quoteRequest.conversationId,
        quoteRequestId: fee.quoteRequestId,
        quotationId: fee.quotationId,
      },
      update: {},
    });
  });
}

export async function processWhatsAppJobs({ limit = 5 }: { limit?: number } = {}) {
  let processed = 0;
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)));
  for (let index = 0; index < safeLimit; index += 1) {
    const job = await claimJob();
    if (!job) break;
    try {
      const telemetry = await processJob(job);
      await completeJob(job, telemetry);
      processed += 1;
    } catch (error) {
      console.error("WhatsApp job processing failed", { jobId: job.id, type: job.type, errorCode: errorCode(error) });
      await failJob(job, error);
    }
  }
  return processed;
}
