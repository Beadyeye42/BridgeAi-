import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type Attachment, type WhatsAppJob } from "@prisma/client";
import { applicationOrigin, metaContactTemplate, metaQuoteTemplate, whatsappConciergeConfig, whatsappMessagingPolicy } from "@/lib/config";
import {
  categoryResponsibilityNotice,
  launchedIntakeCategoryWhere,
  normalizeLaunchCategorySlug,
  unavailableCatalogueForConversation,
} from "@/lib/categories/catalogue";
import { runAsDatabaseWorker } from "@/lib/db";
import { analyzeQuoteAttachment, quoteAttachmentAnalysisSchema, type QuoteAttachmentAnalysis } from "@/lib/ai/attachment-intake";
import { extractQuoteIntake, quoteDraftSchema, type QuoteDraft } from "@/lib/ai/quote-intake";
import { lookupPostcode, PostcodeLookupError } from "@/lib/location/postcodes";
import { evaluateSupplierMatches } from "@/lib/matching/suppliers";
import { expireAndReplaceSupplierInvitations } from "@/lib/matching/replacements";
import { notifySuppliersWithStaleCapacity } from "@/lib/matching/stale-capacity";
import { runProductionMonitoringSafely } from "@/lib/monitoring/operational-alerts";
import { addSupplierResponseHours } from "@/lib/quotes/response-clock";
import { selectQuotationForCustomer } from "@/lib/quotes/selection";
import { processSupplierEmailsSafely } from "@/lib/notifications/email-worker";
import { queueSupplierAssignmentNotifications } from "@/lib/notifications/assignment-notifications";
import { decryptPrivateValue, encryptPrivateValue } from "@/lib/security/encryption";
import { sanitizeCustomerImage } from "@/lib/security/customer-image";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PRIVATE_BUCKET } from "@/lib/storage";
import {
  explicitPreferredFirstName,
  personaliseOpening,
  preferredFirstNameReply,
  profileFirstName,
} from "@/lib/whatsapp/customer-name";
import { downloadMetaMedia, sendMetaTemplate, sendMetaText } from "@/lib/whatsapp/meta-client";
import { writeWhatsAppSystemEvent } from "@/lib/whatsapp/system-events";
import {
  attachmentInterpretation,
  earliestInboundAt,
  firstContactConsentReply,
  isCancelAllDraftsRequest,
  isCancelDraftRequest,
  isConversationOptOut,
  isMenuRequest,
  isNewQuoteRequest,
  isQuoteConfirmation,
  newQuoteDetails,
  isQuoteHistoryRequest,
  isQuoteRefresh,
  isServiceWindowOpen,
  quoteSelectionIntent,
  quoteMenu,
  wasReplyRecentlySent,
} from "@/lib/whatsapp/policy";
import {
  compositeDoorPhotoDecision,
  compositeDoorStylePhotoPrompt,
  conversationProgress,
  enforceTradeClarification,
  industrySelectionPrompt,
  pheSpecificationDecision,
  pheSpecificationPrompt,
  quoteDraftFingerprint,
  repeatClarification,
  requiredQuestionKey,
  roofGlazingSpecificationDecision,
  roofGlazingSpecificationPrompt,
  tradeSpecificationClarification,
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
  return terminal;
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

  let prepared: {
    bytes: Uint8Array;
    mimeType: string;
    extension: string;
    scanStatus: "PENDING" | "CLEAN";
  } = {
    bytes: downloaded.bytes,
    mimeType: downloaded.mimeType,
    extension: downloaded.extension,
    scanStatus: "PENDING" as const,
  };
  if (downloaded.mimeType === "image/jpeg" || downloaded.mimeType === "image/png") {
    try {
      const sanitized = await sanitizeCustomerImage(downloaded.bytes, downloaded.mimeType);
      prepared = { ...sanitized, scanStatus: "CLEAN" as const };
    } catch (error) {
      if (["CUSTOMER_IMAGE_SANITIZE_FAILED", "CUSTOMER_IMAGE_SANITIZED_TOO_LARGE"].includes(errorCode(error))) {
        return { stored: false, rejected: true };
      }
      throw error;
    }
  }

  const storedSha256 = createHash("sha256").update(prepared.bytes).digest("hex");
  const storageKey = `customers/${conversationId}/messages/${message.id}/${randomUUID()}.${prepared.extension}`;
  const storage = getSupabaseAdmin().storage.from(PRIVATE_BUCKET);
  const uploaded = await storage.upload(storageKey, prepared.bytes, {
    contentType: prepared.mimeType,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploaded.error) throw new Error("CUSTOMER_MEDIA_STORAGE_FAILED");
  try {
    const attachment = await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      const attachment = await tx.attachment.create({
        data: {
          kind: prepared.mimeType.startsWith("image/") ? "PHOTO" : "DRAWING",
          fileName: downloaded.fileName,
          mimeType: prepared.mimeType,
          byteSize: prepared.bytes.byteLength,
          storageKey,
          sha256: storedSha256,
          scanStatus: prepared.scanStatus,
          whatsappMessageId: message.id,
        },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.MEDIA_STORED",
        entityType: "Attachment",
        entityId: attachment.id,
        summary: prepared.scanStatus === "CLEAN"
          ? "Customer image was safely rebuilt and stored privately"
          : "Customer document stored privately and queued for security scanning",
        metadata: {
          messageId: message.id,
          mimeType: prepared.mimeType,
          byteSize: prepared.bytes.byteLength,
          scanStatus: prepared.scanStatus,
          imageReencoded: prepared.scanStatus === "CLEAN",
        },
      });
      return attachment;
    });
    return { stored: true, rejected: false, attachment, bytes: prepared.bytes };
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

function consentReply(input: { hasMedia: boolean; hasText: boolean }) {
  const origin = process.env.APP_URL?.trim();
  const privacyUrl = origin ? `${applicationOrigin(origin)}/legal/privacy` : "/legal/privacy";
  return firstContactConsentReply({ privacyUrl, ...input });
}

export function isConsent(value: string) {
  return /^(continue|i agree|agree)$/i.test(value.trim());
}

export function formatConfirmation(draft: QuoteDraft, categoryName: string, attachmentCount = 0, firstName: string | null = null, responsibilityNotice: string | null = null) {
  const items = draft.items.map((item, index) => (
    `${index + 1}. ${item.quantity} ${item.unit} — ${item.description}${item.specification ? ` — ${item.specification}` : ""}`
  )).join("\n");
  return [
    firstName
      ? `Great, ${firstName} — here’s the job I’ll send to suitable approved suppliers:`
      : "Great — here’s the job I’ll send to suitable approved suppliers:",
    `Project: ${draft.title}`,
    `Category: ${categoryName}`,
    `Delivery: ${draft.deliveryPostcode}`,
    draft.requiredManufacturer ? `Manufacturer: ${draft.requiredManufacturer}` : null,
    draft.requiredSystem ? `System: ${draft.requiredSystem}` : null,
    draft.requiredColour ? `Colour: ${draft.requiredColour}` : null,
    draft.requiredFinish ? `Finish: ${draft.requiredFinish}` : null,
    draft.requiredBy ? `Required by: ${new Date(draft.requiredBy).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}` : null,
    draft.collectionRequired ? "Fulfilment: Collection required" : null,
    `Requirements: ${draft.summary}`,
    items,
    attachmentCount > 0
      ? `Files: ${attachmentCount} received securely and added to this job`
      : "For the most accurate pricing, send a photo, drawing or PDF now if you have one. You can still continue without a file.",
    draft.customerBudget === null ? null : `Budget: £${draft.customerBudget.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`,
    responsibilityNotice,
    "Reply YES or CONFIRM to send it, or tell me what to change.",
  ].filter(Boolean).join("\n\n");
}

function encryptedPreferredFirstName(conversation: NonNullable<LoadedJob["conversation"]>) {
  const encrypted = conversation.customerContact.preferredFirstNameEncrypted;
  return encrypted ? decryptPrivateValue(encrypted) : null;
}

function explicitNameFromRecentMessages(
  conversation: NonNullable<LoadedJob["conversation"]>,
) {
  const candidates = conversation.messages
    .filter((message) => message.direction === "INBOUND" && message.bodyEncrypted)
    .map((message) => decryptPrivateValue(message.bodyEncrypted!));
  for (const candidate of candidates) {
    const firstName = explicitPreferredFirstName(candidate);
    if (firstName) return firstName;
  }
  return null;
}

async function resolvePreferredFirstName(
  conversation: NonNullable<LoadedJob["conversation"]>,
  inbound: NonNullable<LoadedJob["whatsappMessage"]>,
  text: string,
  allowAsk: boolean,
) {
  const existing = encryptedPreferredFirstName(conversation);
  const currentExplicit = explicitPreferredFirstName(text);
  const askedReply = conversation.aiLastQuestionKey === "PREFERRED_NAME"
    ? preferredFirstNameReply(text)
    : null;
  const historicalExplicit = !currentExplicit && !askedReply
    ? explicitNameFromRecentMessages(conversation)
    : null;
  const explicit = currentExplicit ?? historicalExplicit;
  const profile = !existing && !explicit && !askedReply && conversation.customerContact.displayNameEncrypted
    ? profileFirstName(decryptPrivateValue(conversation.customerContact.displayNameEncrypted))
    : null;
  const firstName = explicit ?? askedReply ?? existing ?? profile;
  const source = explicit ? "explicit" : askedReply ? "asked_reply" : profile ? "whatsapp_profile" : null;

  if (firstName && (!existing || firstName !== existing)) {
    const action = existing ? "WHATSAPP.PREFERRED_FIRST_NAME_UPDATED" : "WHATSAPP.PREFERRED_FIRST_NAME_SAVED";
    const updated = await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.customerContact.update({
        where: { id: conversation.customerContactId },
        data: { preferredFirstNameEncrypted: encryptPrivateValue(firstName) },
      });
      const next = await tx.conversation.update({
        where: { id: conversation.id },
        data: conversation.aiLastQuestionKey === "PREFERRED_NAME" ? { aiLastQuestionKey: null } : {},
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
        action,
        entityType: "CustomerContact",
        entityId: conversation.customerContactId,
        summary: existing
          ? "Customer updated their encrypted preferred first name"
          : "Encrypted customer preferred first name recorded",
        metadata: { messageId: inbound.id, source },
      });
      return next;
    });
    return { conversation: updated, firstName, capturedThisTurn: true, shouldAsk: false };
  }

  if (firstName) {
    return { conversation, firstName, capturedThisTurn: false, shouldAsk: false };
  }

  if (allowAsk && !conversation.customerContact.preferredNameAskedAt) {
    const askedAt = new Date();
    const updated = await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.customerContact.update({
        where: { id: conversation.customerContactId },
        data: { preferredNameAskedAt: askedAt },
      });
      const next = await tx.conversation.update({
        where: { id: conversation.id },
        data: { aiLastQuestionKey: "PREFERRED_NAME" },
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
        action: "WHATSAPP.PREFERRED_FIRST_NAME_REQUESTED",
        entityType: "CustomerContact",
        entityId: conversation.customerContactId,
        summary: "Customer was asked once for a preferred first name",
        metadata: { messageId: inbound.id },
      });
      return next;
    });
    return { conversation: updated, firstName: null, capturedThisTurn: false, shouldAsk: true };
  }

  if (conversation.aiLastQuestionKey === "PREFERRED_NAME") {
    const updated = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.conversation.update({
      where: { id: conversation.id },
      data: { aiLastQuestionKey: null },
      include: {
        customerContact: true,
        messages: {
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          take: 30,
          include: { attachments: true },
        },
      },
    }));
    return { conversation: updated, firstName: null, capturedThisTurn: false, shouldAsk: false };
  }

  return { conversation, firstName: null, capturedThisTurn: false, shouldAsk: false };
}

export function draftIsComplete(draft: QuoteDraft) {
  return Boolean(draft.deliveryPostcode && draft.categorySlug && draft.title && draft.summary && draft.items.length > 0);
}

async function createQuoteRequest(job: WhatsAppJob, loaded: LoadedJob, draft: QuoteDraft) {
  if (!loaded.conversation) throw new Error("CONVERSATION_NOT_FOUND");
  const confirmationMessage = loaded.whatsappMessage;
  if (!confirmationMessage) throw new Error("CONFIRMATION_MESSAGE_NOT_FOUND");
  const category = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.productCategory.findUnique({
    where: { slug: draft.categorySlug ?? "" },
    select: { id: true, name: true, active: true, parent: { select: { active: true } } },
  }));
  if (!category?.active || !category.parent?.active || !draftIsComplete(draft)) throw new Error("QUOTE_DRAFT_INCOMPLETE");
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
    const matchingConfiguration = await tx.matchingConfiguration.findUnique({ where: { id: "default" } });
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
        requiredManufacturer: draft.requiredManufacturer,
        requiredSystem: draft.requiredSystem,
        requiredColour: draft.requiredColour,
        requiredFinish: draft.requiredFinish,
        requiredBy: draft.requiredBy ? new Date(draft.requiredBy) : null,
        collectionRequired: draft.collectionRequired,
        fulfilmentMode: draft.fulfilmentMode ?? (draft.collectionRequired ? "COLLECTION" : "DELIVERY"),
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
    const evaluations = await evaluateSupplierMatches(
      tx,
      { ...request, items: draft.items },
      {
        postcode: delivery.postcode,
        latitude: delivery.latitude,
        longitude: delivery.longitude,
      },
    );
    const matches = evaluations
      .filter((evaluation) => evaluation.outcome === "MATCHED")
      .slice(0, Math.min(distributionLimit, matchingConfiguration?.maximumSuppliersPerRequest ?? 3, 3));
    const selectedSupplierIds = new Set(matches.map((match) => match.id));
    for (const evaluation of evaluations) {
      await tx.supplierMatchDecision.upsert({
        where: {
          quoteRequestId_supplierCompanyId: {
            quoteRequestId: request.id,
            supplierCompanyId: evaluation.id,
          },
        },
        create: {
          quoteRequestId: request.id,
          supplierCompanyId: evaluation.id,
          outcome: evaluation.outcome,
          score: evaluation.score,
          selected: selectedSupplierIds.has(evaluation.id),
          reasons: evaluation.reasons,
          capabilitySnapshot: evaluation.capabilitySnapshot,
          membershipTier: evaluation.membershipTier,
          coveragePurpose: evaluation.coveragePurpose,
          distanceMiles: evaluation.distanceMiles,
          rankingSnapshot: evaluation.rankingSnapshot,
        },
        update: {
          outcome: evaluation.outcome,
          score: evaluation.score,
          selected: selectedSupplierIds.has(evaluation.id),
          reasons: evaluation.reasons,
          capabilitySnapshot: evaluation.capabilitySnapshot,
          membershipTier: evaluation.membershipTier,
          coveragePurpose: evaluation.coveragePurpose,
          distanceMiles: evaluation.distanceMiles,
          rankingSnapshot: evaluation.rankingSnapshot,
          decidedAt: now,
        },
      });
    }
    const assignedSupplierIds: string[] = [];
    const invitationDeadline = addSupplierResponseHours(now, matchingConfiguration?.responseDeadlineHours ?? 8);
    for (const [index, match] of matches.entries()) {
      const assignment = await tx.supplierAssignment.create({
        data: {
          quoteRequestId: request.id,
          supplierCompanyId: match.id,
          status: "PENDING",
          expiresAt: invitationDeadline < request.responseDueAt ? invitationDeadline : request.responseDueAt,
          assignedById: null,
          invitationRank: index + 1,
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
          matchingScore: match.score,
          matchingReasons: match.reasons,
          capabilitySnapshot: match.capabilitySnapshot,
          responseDueAt: request.responseDueAt.toISOString(),
        },
      });
    }
    if (assignedSupplierIds.length > 0) {
      await queueSupplierAssignmentNotifications(tx, {
        supplierCompanyIds: assignedSupplierIds,
        reference: request.reference,
        title: request.title,
        responseDueAt: invitationDeadline < request.responseDueAt ? invitationDeadline : request.responseDueAt,
      });
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
    draft?.title ? "Reply CANCEL DRAFT to clear only that unfinished job." : null,
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
      metadata: {
        messageId: inbound.id,
        previousStage: conversation.aiStage,
        previousDraftDiscarded: Boolean(conversation.aiDraftEncrypted),
        startedAt: startedAt.toISOString(),
      },
    });
    return next;
  });
  if (announce) {
    await sendReply(job, updated, conversation.aiDraftEncrypted
      ? "Done — I’ve cleared the previous unsent draft so the jobs cannot get mixed together. No confirmed request was changed. Which industry and product is the new quote for? You can type the details or send a photo, drawing, schedule or PDF."
      : "Brilliant — let’s price another job. Which industry and product is it for? You can type the details or send a photo, drawing, schedule or PDF.");
  }
  return updated;
}

async function cancelQuoteDrafts(
  job: WhatsAppJob,
  conversation: NonNullable<LoadedJob["conversation"]>,
  inbound: NonNullable<LoadedJob["whatsappMessage"]>,
  allDrafts: boolean,
) {
  const startedAt = inbound.occurredAt;
  const currentDraftCount = conversation.aiDraftEncrypted ? 1 : 0;
  const result = await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    const otherDrafts = allDrafts
      ? await tx.conversation.updateMany({
          where: {
            customerContactId: conversation.customerContactId,
            id: { not: conversation.id },
            aiDraftEncrypted: { not: null },
          },
          data: {
            aiStage: "COLLECTING",
            aiDraftEncrypted: null,
            aiDraftFingerprint: null,
            aiLastQuestionKey: null,
            aiUnproductiveTurns: 0,
            closedAt: null,
          },
        })
      : { count: 0 };
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
    const clearedDraftCount = currentDraftCount + otherDrafts.count;
    await writeWhatsAppAudit(tx, {
      action: allDrafts ? "WHATSAPP.ALL_DRAFTS_CANCELLED" : "WHATSAPP.DRAFT_CANCELLED",
      entityType: "Conversation",
      entityId: conversation.id,
      summary: allDrafts
        ? "Customer cleared every unfinished WhatsApp quote draft"
        : "Customer cleared the current unfinished WhatsApp quote draft",
      metadata: {
        messageId: inbound.id,
        clearedDraftCount,
        submittedRequestsChanged: false,
        startedAt: startedAt.toISOString(),
      },
    });
    return { next, clearedDraftCount };
  });

  const cleared = result.clearedDraftCount > 0
    ? allDrafts
      ? `Done — I’ve cleared ${result.clearedDraftCount} unfinished draft${result.clearedDraftCount === 1 ? "" : "s"}.`
      : "Done — I’ve cancelled the unfinished draft."
    : "There was no unfinished draft to cancel, so you’re already starting clean.";
  await sendReply(
    job,
    result.next,
    `${cleared} No confirmed or live quote requests were changed.\n\nWhich industry and product would you like a new quote for? You can type the details or send a photo, drawing, schedule or PDF.`,
  );
  return result.next;
}

async function processInbound(job: WhatsAppJob, loaded: LoadedJob) {
  const initialConversation = loaded.conversation;
  const inbound = loaded.whatsappMessage;
  if (!initialConversation || !inbound || inbound.direction !== "INBOUND") throw new Error("INBOUND_JOB_INVALID");
  let conversation: NonNullable<LoadedJob["conversation"]> = initialConversation;
  let justConsented = false;
  let preferredFirstName: string | null = null;
  let nameCapturedThisTurn = false;
  const text = inbound.bodyEncrypted ? decryptPrivateValue(inbound.bodyEncrypted) : "";
  const selectionIntent = quoteSelectionIntent(text);

  const controlMessage = isConversationOptOut(text)
    || isConsent(text)
    || isCancelAllDraftsRequest(text)
    || isCancelDraftRequest(text)
    || isQuoteConfirmation(text)
    || isQuoteRefresh(text)
    || isNewQuoteRequest(text)
    || isQuoteHistoryRequest(text)
    || isMenuRequest(text)
    || selectionIntent !== null;
  if (!controlMessage && await hasNewerInboundJob(job)) {
    return undefined;
  }

  if (isConversationOptOut(text)) {
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
      await sendReply(job, conversation, consentReply({
        hasMedia: Boolean(inbound.mediaIdEncrypted),
        hasText: Boolean(text.trim()),
      }));
      return undefined;
    }
    const consentedAt = new Date();
    const sessionStartedAt = earliestInboundAt(conversation.messages, consentedAt);
    const consentedConversation = await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      const updated = await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          aiConsentAt: consentedAt,
          aiSessionStartedAt: sessionStartedAt,
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
        metadata: { messageId: inbound.id, sessionStartedAt: sessionStartedAt.toISOString() },
      });
      return updated;
    });
    conversation = consentedConversation;
    justConsented = true;
  }

  const preferredName = await resolvePreferredFirstName(
    conversation,
    inbound,
    text,
    justConsented || (!controlMessage && conversation.aiStage === "COLLECTING"),
  );
  conversation = preferredName.conversation;
  preferredFirstName = preferredName.firstName;
  nameCapturedThisTurn = preferredName.capturedThisTurn;
  if (preferredName.shouldAsk) {
    await sendReply(job, conversation, "Before we start, what should I call you? Just your first name is fine.");
    return undefined;
  }

  if (isCancelAllDraftsRequest(text) || isCancelDraftRequest(text)) {
    await cancelQuoteDrafts(job, conversation, inbound, isCancelAllDraftsRequest(text));
    return undefined;
  }

  if (conversation.aiStage !== "AWAITING_SELECTION" && isNewQuoteRequest(text)) {
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
  const currentAttachmentAnalyses: QuoteAttachmentAnalysis[] = [];
  for (const message of mediaMessages) {
    const outcome = await persistMedia(message, conversation.id);
    rejectedMedia ||= outcome.rejected;
    if (outcome.attachment) {
      if (message.id === inbound.id || justConsented) currentAttachmentCount += 1;
      const analysis = await ensureAttachmentAnalysis(
        outcome.attachment,
        outcome.bytes,
        conversation.customerContact.phoneHash,
      );
      if (analysis) {
        attachmentAnalyses.push(analysis);
        if (message.id === inbound.id || justConsented) currentAttachmentAnalyses.push(analysis);
      }
    }
  }

  const refreshed = await loadJob(job.id);
  if (!refreshed?.conversation) throw new Error("CONVERSATION_NOT_FOUND");
  const stage = refreshed.conversation.aiStage;
  const decryptedDraft = decryptDraft(refreshed.conversation.aiDraftEncrypted);
  const draft = decryptedDraft
    ? { ...decryptedDraft, categorySlug: normalizeLaunchCategorySlug(decryptedDraft.categorySlug) }
    : null;

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

  if (stage === "AWAITING_CONFIRMATION" && isQuoteConfirmation(text)) {
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
    await sendReply(job, refreshed.conversation, personaliseOpening(
      `Perfect — request ${request.request.reference} is live. ${distributionMessage} I’ll bring the available prices and lead times back here while keeping identities private. Reply QUOTES for an update, or NEW QUOTE whenever you have another job to price.`,
      preferredFirstName,
      true,
    ));
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
    const request = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.quoteRequest.findFirst({
      where: { conversationId: refreshed.conversation!.id, status: { in: ["OPEN", "MATCHING", "QUOTED"] } },
      orderBy: { createdAt: "desc" },
      include: { quotations: { where: { status: "SUBMITTED" }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 5 } },
    }));
    if (!request || !request.quotations.length) {
      await sendReply(job, refreshed.conversation, "That quote is no longer available. Reply QUOTES and I’ll show the latest prices and lead times.");
      return undefined;
    }
    if (!selectionIntent) {
      await sendReply(job, refreshed.conversation, request.quotations.length === 1
        ? "There is one quote available. Reply YES or ACCEPT and I’ll confirm it for you."
        : `Which quote would you like? Reply with just its number, from 1 to ${request.quotations.length}.`);
      return undefined;
    }
    if (selectionIntent.kind === "REFERENCE" && selectionIntent.reference !== request.reference.toUpperCase()) {
      await sendReply(job, refreshed.conversation, `That reference is not the quote list currently open. Reply QUOTES to see the latest prices for ${request.reference}.`);
      return undefined;
    }
    if (selectionIntent.kind !== "POSITION" && request.quotations.length > 1) {
      await sendReply(job, refreshed.conversation, `There are ${request.quotations.length} quotes available. Reply with just the quote number you want, from 1 to ${request.quotations.length}.`);
      return undefined;
    }
    const displayedPosition = selectionIntent.kind === "POSITION" ? selectionIntent.position : 1;
    const selected = request.quotations[displayedPosition - 1];
    if (!selected) {
      await sendReply(job, refreshed.conversation, `That number is not available. Reply with a number from 1 to ${request.quotations.length}.`);
      return undefined;
    }
    const grant = await selectQuotationForCustomer({ quotationId: selected.id, evidence: `WhatsApp message ${inbound.externalMessageId}` });
    await enqueueContactUnlock(grant.id);
    await processSupplierEmailsSafely({ limit: 10 });
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.conversation.update({ where: { id: refreshed.conversation!.id }, data: { aiStage: "SELECTION_RECORDED" } });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.QUOTE_SELECTED",
        entityType: "SupplierQuotation",
        entityId: selected.id,
        summary: "Customer selected an anonymised quote through WhatsApp",
        metadata: { messageId: inbound.id, quoteRequestId: request.id, displayedPosition },
      });
    });
    await sendReply(job, refreshed.conversation, `Great choice — quote ${displayedPosition} is confirmed. There is no introduction fee or winning fee. I’m sharing the selected supplier’s business contact details securely now.`);
    return undefined;
  }

  if (["QUOTE_CREATED", "SELECTION_RECORDED", "CLOSED"].includes(stage)) {
    await sendReply(job, refreshed.conversation, stage === "QUOTE_CREATED"
      ? "This request is live and safely stored. I’ll message you when supplier prices and lead times are ready. Reply NEW QUOTE to price another job, or MY QUOTES to see your recent requests."
      : "This quote is complete. Reply NEW QUOTE to price another job, or MY QUOTES to see your recent requests.");
    return undefined;
  }

  const categories = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.productCategory.findMany({
    where: launchedIntakeCategoryWhere(),
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { slug: true, name: true, description: true, parent: { select: { slug: true } } },
    take: 100,
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
        const body = decryptPrivateValue(message.bodyEncrypted);
        const isPreferredNameOnly = preferredFirstName !== null
          && preferredFirstNameReply(body)?.toLocaleLowerCase("en-GB") === preferredFirstName.toLocaleLowerCase("en-GB");
        const isPreferredNameMessage = explicitPreferredFirstName(body) !== null
          || isPreferredNameOnly
          || body === "Before we start, what should I call you? Just your first name is fine.";
        if (!(justConsented && message.id === inbound.id && isConsent(body))
          && !isCancelAllDraftsRequest(body)
          && !isCancelDraftRequest(body)
          && !isPreferredNameMessage) {
          parts.push({ direction: message.direction, text: body });
        }
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
  const unavailableCatalogue = unavailableCatalogueForConversation(
    messages.filter((message) => message.direction === "INBOUND").map((message) => message.text).join("\n"),
    categories.map((category) => category.slug),
  );
  if (unavailableCatalogue) {
    await runAsDatabaseWorker("whatsapp_ai", (tx) => writeWhatsAppAudit(tx, {
      action: "WHATSAPP.UNLAUNCHED_CATEGORY_BLOCKED",
      entityType: "Conversation",
      entityId: refreshed.conversation!.id,
      summary: "Customer request for an unlaunched product catalogue was not routed",
      metadata: { jobId: job.id, code: unavailableCatalogue.code },
    }));
    await sendReply(job, refreshed.conversation, unavailableCatalogue.reply);
    return undefined;
  }
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
  result.tradeClarification = enforceTradeClarification(
    result.draft,
    result.tradeClarification,
    messages.filter((message) => message.direction === "INBOUND").map((message) => message.text),
  );
  if (result.needsHumanReview) {
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.conversation.update({ where: { id: refreshed.conversation!.id }, data: { aiStage: "HUMAN_REVIEW", aiDraftEncrypted: encryptPrivateValue(JSON.stringify(result.draft)) } });
      await writeWhatsAppSystemEvent(tx, "whatsapp_ai", { severity: "WARNING", code: "CUSTOMER_CONVERSATION_REVIEW", message: "A WhatsApp conversation requires administrator review", context: { conversationId: refreshed.conversation!.id, jobId: job.id } });
    });
    await sendReply(job, refreshed.conversation, "I can’t safely complete this request automatically. A Bridge AI administrator will need to review it.");
    return telemetry;
  }
  const compositeDoorPhoto = compositeDoorPhotoDecision(result.draft, messages);
  const roofGlazingSpecification = roofGlazingSpecificationDecision(result.draft, messages);
  const pheSpecification = pheSpecificationDecision(result.draft, messages);
  const category = result.draft.categorySlug ? categories.find((item) => item.slug === result.draft.categorySlug) : undefined;
  const isIndustryRoot = Boolean(category && !category.parent);
  if (compositeDoorPhoto.handled && result.nextQuestionKey === "COMPOSITE_STYLE") {
    result.nextQuestionKey = "NONE";
  }
  if (!roofGlazingSpecification.shouldAsk && result.nextQuestionKey === "ROOF_GLAZING_SPECIFICATION") {
    result.nextQuestionKey = "NONE";
  }
  if (!pheSpecification.shouldAsk && result.nextQuestionKey === "PHE_SPECIFICATION") {
    result.nextQuestionKey = "NONE";
  }
  const questionKey = compositeDoorPhoto.shouldAsk
    ? "COMPOSITE_STYLE"
    : roofGlazingSpecification.shouldAsk
      ? "ROOF_GLAZING_SPECIFICATION"
      : isIndustryRoot
        ? "PRODUCT"
        : pheSpecification.shouldAsk
          ? "PHE_SPECIFICATION"
          : requiredQuestionKey(result.draft, result.nextQuestionKey, result.tradeClarification);
  const ready = result.readyForConfirmation && Boolean(category?.parent) && questionKey === "NONE" && draftIsComplete(result.draft);
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
    ? attachmentInterpretation(currentAttachmentAnalyses.map((analysis) => analysis.summary))
      ?? `I’ve securely received and read ${currentAttachmentCount === 1 ? "that file" : `those ${currentAttachmentCount} files`} and added the useful details.`
    : null;
  const repeatedClarification = !ready && progress.repeatedQuestion && !progress.progressed
    ? questionKey === "INDUSTRY"
      ? industrySelectionPrompt(categories.filter((item) => !item.parent).map((item) => item.name))
      : repeatClarification(questionKey)
    : null;
  const tradeClarification = !ready && questionKey === "SPECIFICATION"
    ? tradeSpecificationClarification(result.tradeClarification, result.draft.items[0]?.description)
    : null;
  const enforcedClarification = !ready && questionKey !== result.nextQuestionKey
    ? questionKey === "INDUSTRY"
      ? industrySelectionPrompt(categories.filter((item) => !item.parent).map((item) => item.name))
      : repeatClarification(questionKey)
    : null;
  const reply = ready && category
      ? formatConfirmation(
        result.draft,
        category.name,
        attachmentCount,
        preferredFirstName,
        categoryResponsibilityNotice(category.slug, category.parent?.slug),
      )
      : `${mediaAcknowledgement ? `${mediaAcknowledgement}\n\n` : ""}${compositeDoorPhoto.shouldAsk ? compositeDoorStylePhotoPrompt() : roofGlazingSpecification.shouldAsk ? roofGlazingSpecificationPrompt(roofGlazingSpecification) : pheSpecification.shouldAsk ? pheSpecificationPrompt(pheSpecification.categorySlug) : tradeClarification ?? repeatedClarification ?? enforcedClarification ?? result.reply}${rejectedMedia ? "\n\nOne uploaded file could not be accepted. Please send a genuine JPG, PNG or PDF within the size limit." : ""}`;
  await sendReply(
    job,
    refreshed.conversation,
    personaliseOpening(reply, preferredFirstName, !ready && (justConsented || nameCapturedThisTurn)),
  );
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
      quotes.length === 1
        ? "To accept this quote, simply reply YES or ACCEPT. There are no introduction or winning fees."
        : `To choose, reply with just the quote number (1 to ${quotes.length}). There are no introduction or winning fees.`,
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
  }));
  if (!grant || grant.revokedAt) throw new Error("CONTACT_UNLOCK_NOT_AUTHORISED");
  const supplier = loaded.quotation.supplierCompany;
  const supplierName = supplier.tradingName ?? supplier.legalName;
  const body = [
    `Your selection is confirmed for ${loaded.quoteRequest.reference}. You and the selected supplier can now contact each other.`,
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
      summary: "Selected supplier contact details sent after customer selection",
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

export async function enqueueContactUnlock(contactAccessGrantId: string) {
  return runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    const grant = await tx.contactAccessGrant.findUnique({
      where: { id: contactAccessGrantId },
      include: { quotation: { include: { quoteRequest: true } } },
    });
    if (!grant || grant.revokedAt || !grant.quotation.quoteRequest.conversationId) return null;
    return tx.whatsAppJob.upsert({
      where: { idempotencyKey: `contact-unlock:${grant.id}` },
      create: {
        type: "SEND_CONTACT_UNLOCK",
        idempotencyKey: `contact-unlock:${grant.id}`,
        conversationId: grant.quotation.quoteRequest.conversationId,
        quoteRequestId: grant.quotation.quoteRequestId,
        quotationId: grant.quotationId,
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
      const terminal = await failJob(job, error);
      if (terminal) await runProductionMonitoringSafely();
    }
  }

  // Vercel Hobby cron jobs can run only once per day. Recovering these durable
  // queues after normal WhatsApp activity keeps winner emails and operational
  // alerts moving without weakening idempotency or sending duplicate messages.
  await expireAndReplaceSupplierInvitations({ limit: 25 }).catch((error) => {
    console.error("Expired supplier invitation recovery failed", error);
  });
  await notifySuppliersWithStaleCapacity({ limit: 50 }).catch((error) => {
    console.error("Stale supplier capacity reminder failed", error);
  });
  await processSupplierEmailsSafely({ limit: 25 });
  await runProductionMonitoringSafely();

  return processed;
}
