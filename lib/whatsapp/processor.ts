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
import { hyperlocalService, inferUrgency, recurrenceCadence } from "@/lib/categories/hyperlocal-industries";
import { isTransportCategorySlug, matchingCoveragePurpose, resolveTransportCollectionPostcode } from "@/lib/categories/transport";
import { runAsDatabaseWorker } from "@/lib/db";
import { analyzeQuoteAttachment, quoteAttachmentAnalysisSchema, type QuoteAttachmentAnalysis } from "@/lib/ai/attachment-intake";
import { extractQuoteIntake, quoteDraftSchema, type QuoteDraft } from "@/lib/ai/quote-intake";
import { lookupPostcode, PostcodeLookupError } from "@/lib/location/postcodes";
import { evaluateSupplierMatches, selectAdaptiveSupplierMatches } from "@/lib/matching/suppliers";
import { lockSupplierAssignmentScope, recordMatchingEvaluation } from "@/lib/matching/distribution";
import { runProductionMonitoringSafely } from "@/lib/monitoring/operational-alerts";
import { addSupplierResponseHours } from "@/lib/quotes/response-clock";
import { selectQuotationForCustomer } from "@/lib/quotes/selection";
import { createBuyerQuestion, newBroadcastKey } from "@/lib/quotes/conversations";
import { moderatePreSelectionQuoteMessage } from "@/lib/quotes/message-moderation";
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
import { attachmentAutomationDecision } from "@/lib/whatsapp/attachment-policy";
import { buyerTypeAllowed, buyerTypeLabel, classifyBuyerType } from "@/lib/whatsapp/buyer-classification";
import {
  isClearCataloguePivot,
  productMessageIntent,
  productRecoveryReply,
  recogniseCatalogueProduct,
} from "@/lib/whatsapp/product-knowledge";
import { writeWhatsAppSystemEvent } from "@/lib/whatsapp/system-events";
import { quoteQuestionWhatsAppHelp } from "@/lib/whatsapp/industry-question-guidance";
import {
  attachmentInterpretation,
  conversationPivotContext,
  earliestInboundAt,
  firstContactConsentReply,
  industryQuoteOfferReply,
  intakeFailureRecovery,
  isCancelAllDraftsRequest,
  isCancelDraftRequest,
  isConversationOptOut,
  isConversationalHelpRequest,
  isIndustryQuoteOfferAccepted,
  isIndustryQuoteOfferDeclined,
  isMenuRequest,
  isNewQuoteRequest,
  isQuoteConfirmation,
  newQuoteDetails,
  isQuoteHistoryRequest,
  isQuoteRefresh,
  isServiceWindowOpen,
  quoteQuestionIntent,
  quoteSelectionIntent,
  quoteMenu,
  wasReplyRecentlySent,
} from "@/lib/whatsapp/policy";
import {
  compositeDoorPhotoDecision,
  compositeDoorStylePhotoPrompt,
  conversationalRecoveryPrompt,
  conversationProgress,
  enforceTradeClarification,
  hyperlocalServiceIntakeDecision,
  pheSpecificationDecision,
  pheSpecificationPrompt,
  productSelectionPrompt,
  quoteDraftFingerprint,
  repeatClarification,
  requiredQuestionKey,
  resolveCustomerDeadline,
  roofGlazingSpecificationDecision,
  roofGlazingSpecificationPrompt,
  tradeSpecificationClarification,
  transportIntakeDecision,
  transportIntakePrompt,
  universalRequestPrompt,
} from "@/lib/whatsapp/intake-state";

const MAX_ATTEMPTS = 3;
const STALE_LOCK_MS = 5 * 60_000;
const TRANSIENT_RETRY_DELAY_MS = 5_000;

type IntakeCategory = {
  slug: string;
  name: string;
  description: string | null;
  servesConsumer: boolean;
  servesTrade: boolean;
  servesBusiness: boolean;
  parent: { slug: string; servesConsumer: boolean; servesTrade: boolean; servesBusiness: boolean } | null;
};

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

function emptyQuoteDraft(categorySlug: string | null = null): QuoteDraft {
  return quoteDraftSchema.parse({
    customerName: null,
    buyerType: null,
    intentQuality: "QUALIFIED",
    collectionPostcode: null,
    deliveryPostcode: null,
    categorySlug,
    title: null,
    summary: null,
    customerBudget: null,
    requiredManufacturer: null,
    requiredSystem: null,
    requiredColour: null,
    requiredFinish: null,
    requiredBy: null,
    collectionRequired: false,
    fulfilmentMode: null,
    items: [],
  });
}

function selectedIndustry(categories: IntakeCategory[], categorySlug: string | null | undefined) {
  if (!categorySlug) return null;
  const category = categories.find((candidate) => candidate.slug === categorySlug);
  if (!category) return null;
  return category.parent
    ? categories.find((candidate) => candidate.slug === category.parent?.slug) ?? null
    : category;
}

function productQuestionForCategory(categorySlug: string | null | undefined) {
  if (categorySlug === "transport-delivery-removals") {
    return "Yes — I can help with transport. What needs moving, and roughly how much? Send the collection and delivery postcodes too if you have them; a photo is welcome.";
  }
  if (categorySlug === "plumbing-heating-mechanical") {
    return "Yes — I can help with plumbing, heating or mechanical supply. What product, system or work do you need? A schedule, drawing or photo is welcome.";
  }
  if (categorySlug === "bespoke-metal-fabrication") {
    return "Yes — I can help with fabrication. What needs making, and roughly how many? Send a drawing, dimensions or photo if you have one.";
  }
  if (categorySlug === "garage-industrial-specialist-doors") {
    return "Yes — I can help with specialist doors. What type of door or opening do you need? A photo, survey or opening size is welcome.";
  }
  return productSelectionPrompt();
}

function replaceLatestNumberedReply(
  messages: Array<{ direction: "INBOUND" | "OUTBOUND"; text: string }>,
  rawReply: string,
  replacement: string,
) {
  const index = messages.findLastIndex((message) => (
    message.direction === "INBOUND" && message.text.trim() === rawReply.trim()
  ));
  if (index >= 0) messages[index] = { direction: "INBOUND", text: replacement };
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
      quoteMessage: { include: { quoteConversation: true } },
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
    || code === "META_CONTACT_TEMPLATE_REQUIRED"
    || code === "OPENAI_AUTHENTICATION_FAILED"
    || code === "OPENAI_PERMISSION_DENIED"
    || code === "OPENAI_MODEL_NOT_FOUND"
    || code === "OPENAI_MODEL_INVALID"
    || code === "OPENAI_REQUEST_INVALID";
  await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.whatsAppJob.update({
      where: { id: job.id },
      data: terminal
        ? { status: "FAILED", failedAt: new Date(), lockedAt: null, errorCode: code }
        : { status: "PENDING", failedAt: new Date(), lockedAt: null, errorCode: code, availableAt: new Date(Date.now() + TRANSIENT_RETRY_DELAY_MS) },
    });
    if (!terminal) {
      await writeWhatsAppSystemEvent(tx, "whatsapp_ai", {
        severity: "WARNING",
        code: "WHATSAPP_JOB_RETRY_SCHEDULED",
        message: "A transient WhatsApp processing failure was scheduled for automatic retry",
        context: { jobId: job.id, jobType: job.type, errorCode: code, attempts: job.attempts },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.JOB_RETRY_SCHEDULED",
        entityType: "WhatsAppJob",
        entityId: job.id,
        summary: "WhatsApp background job scheduled for automatic retry",
        metadata: { type: job.type, errorCode: code, attempts: job.attempts },
      });
    }
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
  const latestInboundAt = conversation.messages
    .filter((message) => message.direction === "INBOUND")
    .reduce<Date | undefined>((latest, message) => (
      !latest || message.occurredAt > latest ? message.occurredAt : latest
    ), undefined);
  if (wasReplyRecentlySent(recentMessages, body, new Date(), latestInboundAt)) {
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
  if (existing) {
    if (["REJECTED", "FAILED"].includes(existing.scanStatus)) {
      return { stored: true, rejected: true };
    }
    return { stored: true, rejected: false, attachment: existing };
  }
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

async function excludeAttachmentAutomatically(
  attachment: Attachment,
  analysis: QuoteAttachmentAnalysis,
  input: { conversationId: string; jobId: string; messageId: string },
) {
  await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.attachment.updateMany({
      where: { id: attachment.id, scanStatus: { notIn: ["REJECTED", "FAILED"] } },
      data: { scanStatus: "REJECTED" },
    });
    await writeWhatsAppAudit(tx, {
      action: "WHATSAPP.MEDIA_EXCLUDED_AUTOMATICALLY",
      entityType: "Attachment",
      entityId: attachment.id,
      summary: "An unusable customer attachment was automatically excluded without pausing quote intake",
      metadata: {
        conversationId: input.conversationId,
        jobId: input.jobId,
        messageId: input.messageId,
        usefulForQuote: analysis.usefulForQuote,
        modelFlaggedForReview: analysis.needsHumanReview,
      },
    });
  });
  const removed = await getSupabaseAdmin().storage.from(PRIVATE_BUCKET).remove([attachment.storageKey]);
  if (removed.error) {
    await runAsDatabaseWorker("whatsapp_ai", (tx) => writeWhatsAppSystemEvent(tx, "whatsapp_ai", {
      severity: "ERROR",
      code: "CUSTOMER_ATTACHMENT_EXCLUSION_DELETE_FAILED",
      message: "An excluded private customer attachment could not be removed from storage",
      context: { attachmentId: attachment.id, conversationId: input.conversationId, jobId: input.jobId },
    }));
  }
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
  const fulfilmentLabels = {
    SERVICE: "On-site service or repair",
    INSTALLATION: "Supply and installation",
    SUPPLY_ONLY: "Supply only",
    DELIVERY: "Delivery",
    COLLECTION: "Collection",
  } as const;
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
    draft.buyerType ? `Buyer: ${buyerTypeLabel(draft.buyerType)}` : null,
    draft.requiredManufacturer ? `Manufacturer: ${draft.requiredManufacturer}` : null,
    draft.requiredSystem ? `System: ${draft.requiredSystem}` : null,
    draft.requiredColour ? `Colour: ${draft.requiredColour}` : null,
    draft.requiredFinish ? `Finish: ${draft.requiredFinish}` : null,
    draft.requiredBy ? `Required by: ${new Date(draft.requiredBy).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}` : null,
    draft.fulfilmentMode ? `How: ${fulfilmentLabels[draft.fulfilmentMode]}` : null,
    `Requirements: ${draft.summary}`,
    items,
    attachmentCount > 0
      ? `Files: ${attachmentCount} received securely and added to this job`
      : "Supporting file: None yet. Most suppliers quote faster and more confidently from a clear photo, survey, drawing, schedule or PDF, and requests without one may receive fewer responses. Send one now if you can, or continue with your description if you do not have one.",
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
  const evidence = [
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
  ].filter((value): value is string => Boolean(value)).join("\n");
  const transportCollectionPostcode = isTransportCategorySlug(draft.categorySlug)
    ? resolveTransportCollectionPostcode({
      collectionPostcode: draft.collectionPostcode,
      deliveryPostcode: draft.deliveryPostcode,
      evidence,
    })
    : true;
  return Boolean(
    draft.deliveryPostcode
    && draft.buyerType
    && draft.categorySlug
    && draft.title
    && draft.summary
    && draft.requiredBy
    && draft.fulfilmentMode
    && draft.items.length > 0
    && transportCollectionPostcode,
  );
}

async function createQuoteRequest(job: WhatsAppJob, loaded: LoadedJob, draft: QuoteDraft) {
  if (!loaded.conversation) throw new Error("CONVERSATION_NOT_FOUND");
  const confirmationMessage = loaded.whatsappMessage;
  if (!confirmationMessage) throw new Error("CONFIRMATION_MESSAGE_NOT_FOUND");
  const category = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.productCategory.findUnique({
    where: { slug: draft.categorySlug ?? "" },
    select: {
      id: true, name: true, slug: true, active: true,
      acknowledgementDeadlineHours: true, quotationDeadlineHours: true,
      servesConsumer: true, servesTrade: true, servesBusiness: true,
      parent: { select: { active: true, servesConsumer: true, servesTrade: true, servesBusiness: true, acknowledgementDeadlineHours: true, quotationDeadlineHours: true } },
    },
  }));
  if (!category?.active || !category.parent?.active || !draftIsComplete(draft)) throw new Error("QUOTE_DRAFT_INCOMPLETE");
  if (!buyerTypeAllowed(draft.buyerType!, category.parent)) throw new Error("BUYER_TYPE_NOT_SUPPORTED_BY_INDUSTRY");
  const delivery = await lookupPostcode(draft.deliveryPostcode!);
  const now = new Date();
  const requestEvidence = [
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
  ].filter((value): value is string => Boolean(value)).join("\n");
  const collectionPostcode = isTransportCategorySlug(category.slug)
    ? resolveTransportCollectionPostcode({
      collectionPostcode: draft.collectionPostcode,
      deliveryPostcode: delivery.postcode,
      evidence: requestEvidence,
    })
    : null;
  if (isTransportCategorySlug(category.slug) && !collectionPostcode) {
    throw new PostcodeLookupError("INVALID_POSTCODE", "A full collection postcode is required for transport matching");
  }
  const matchingLocation = collectionPostcode ? await lookupPostcode(collectionPostcode) : delivery;
  const coveragePurpose = matchingCoveragePurpose({
    categorySlug: category.slug,
    fulfilmentMode: draft.fulfilmentMode,
  });
  const urgency = inferUrgency(requestEvidence, draft.requiredBy ? new Date(draft.requiredBy) : null, now);
  const recurrence = recurrenceCadence(requestEvidence);
  const hyperlocal = hyperlocalService(draft.categorySlug);
  const sessionAttachments = loaded.conversation.messages
    .filter((message) => message.occurredAt >= loaded.conversation!.aiSessionStartedAt)
    .flatMap((message) => message.attachments)
    .filter((attachment) => !["REJECTED", "FAILED"].includes(attachment.scanStatus));
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
    const configuredQuoteHours = category.parent?.quotationDeadlineHours
      ?? category.quotationDeadlineHours
      ?? matchingConfiguration?.quotationDeadlineHours
      ?? matchingConfiguration?.responseDeadlineHours
      ?? quoteResponseHours;
    const configuredAcknowledgementHours = category.parent?.acknowledgementDeadlineHours
      ?? category.acknowledgementDeadlineHours
      ?? matchingConfiguration?.acknowledgementDeadlineHours
      ?? configuredQuoteHours;
    const request = await tx.quoteRequest.create({
      data: {
        reference,
        conversationId: loaded.conversation!.id,
        customerConfirmationMessageId: confirmationMessage.id,
        customerContactId: loaded.conversation!.customerContactId,
        categoryId: category.id,
        buyerType: draft.buyerType!,
        intentQuality: draft.intentQuality === "URGENT" ? "URGENT" : "READY_TO_BUY",
        urgency,
        recurrenceCadence: recurrence,
        qualificationData: hyperlocal ? {
          industrySlug: hyperlocal.industry.slug,
          serviceSlug: hyperlocal.service.slug,
          requiredInformation: hyperlocal.service.requiredInformation,
          verificationRequirements: hyperlocal.service.verification,
          photoRecommended: Boolean(hyperlocal.service.photoPrompt),
        } : undefined,
        attachmentExtractionConfidence: sessionAttachments.length > 0 ? 0.75 : null,
        title: draft.title!,
        summary: draft.summary!,
        deliveryPostcode: delivery.postcode,
        deliveryLatitude: delivery.latitude,
        deliveryLongitude: delivery.longitude,
        matchingPostcode: matchingLocation.postcode,
        matchingLatitude: matchingLocation.latitude,
        matchingLongitude: matchingLocation.longitude,
        matchingCoveragePurpose: coveragePurpose,
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
        responseDueAt: addSupplierResponseHours(now, configuredQuoteHours),
        publishedAt: now,
        items: { create: draft.items.map((item, index) => ({ ...item, displayOrder: index })) },
      },
    });
    const linkedAttachments = await tx.attachment.updateMany({
      where: {
        quoteRequestId: null,
        scanStatus: { notIn: ["REJECTED", "FAILED"] },
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
        postcode: matchingLocation.postcode,
        latitude: matchingLocation.latitude,
        longitude: matchingLocation.longitude,
      },
    );
    const matches = selectAdaptiveSupplierMatches(
      evaluations,
      Math.min(distributionLimit, matchingConfiguration?.maximumSuppliersPerRequest ?? 5, 5),
    );
    const selectedSupplierIds = new Set(matches.map((match) => match.id));
    await recordMatchingEvaluation(tx, {
      quoteRequestId: request.id,
      categoryId: request.categoryId,
      deliveryPostcode: request.deliveryPostcode,
      matchingPostcode: request.matchingPostcode ?? request.deliveryPostcode,
      evaluations,
      selectedSupplierIds,
      invitedSupplierCount: matches.length,
      alertOnZero: matchingConfiguration?.coverageGapAlertsEnabled ?? true,
    });
    await lockSupplierAssignmentScope(tx, selectedSupplierIds);
    const acknowledgementDueAt = addSupplierResponseHours(now, configuredAcknowledgementHours);
    const assignedSupplierIds: string[] = [];
    for (const [index, match] of matches.entries()) {
      const assignment = await tx.supplierAssignment.create({
        data: {
          quoteRequestId: request.id,
          supplierCompanyId: match.id,
          status: "PENDING",
          expiresAt: request.responseDueAt,
          assignedById: null,
          invitationRank: index + 1,
          marketDensityMode: match.marketDensityMode,
          softCapOverride: match.softCapOverride,
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
          acknowledgementDueAt: acknowledgementDueAt.toISOString(),
          quotationDueAt: request.responseDueAt.toISOString(),
        },
      });
    }
    if (assignedSupplierIds.length > 0) {
      await queueSupplierAssignmentNotifications(tx, {
        supplierCompanyIds: assignedSupplierIds,
        reference: request.reference,
        title: request.title,
        responseDueAt: request.responseDueAt,
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
        buyerType: draft.buyerType,
        intentQuality: draft.intentQuality === "URGENT" ? "URGENT" : "READY_TO_BUY",
        itemCount: draft.items.length,
        attachmentCount: linkedAttachments.count,
        distributionLimit,
        automaticAssignmentCount: assignedSupplierIds.length,
        urgency,
        recurrenceCadence: recurrence,
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
  if (["WON", "SELECTED"].includes(status)) return "supplier selected—final arrangements pending";
  if (status === "CONFIRMED") return "job confirmed";
  if (status === "COMPLETED") return "completed";
  if (status === "CANCELLED_AFTER_SELECTION") return "did not proceed after selection";
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

async function confirmedRequestReply(conversation: NonNullable<LoadedJob["conversation"]>) {
  const request = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.quoteRequest.findFirst({
    where: {
      customerContactId: conversation.customerContactId,
      status: { in: ["OPEN", "MATCHING", "QUOTED"] },
    },
    orderBy: { createdAt: "desc" },
    select: { reference: true },
  }));
  return request
    ? `Your confirmation is already safely recorded — request ${request.reference} is live. I’ll bring the available prices and lead times back here. Reply QUOTES for an update, or NEW QUOTE to price another job.`
    : "Your confirmation is already safely recorded. Reply MY QUOTES to see your recent requests, or NEW QUOTE to price another job.";
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
        aiLastQuestionKey: announce ? "PRODUCT" : null,
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
      ? `Done — I’ve cleared the previous unsent draft so the jobs cannot get mixed together. No confirmed request was changed.\n\n${universalRequestPrompt()}`
      : `Brilliant — let’s Bridge another request.\n\n${universalRequestPrompt()}`);
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
        aiLastQuestionKey: "PRODUCT",
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
    `${cleared} No confirmed or live quote requests were changed.\n\n${universalRequestPrompt()}`,
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
  const questionIntent = quoteQuestionIntent(text);

  const controlMessage = isConversationOptOut(text)
    || isConsent(text)
    || isCancelAllDraftsRequest(text)
    || isCancelDraftRequest(text)
    || isIndustryQuoteOfferAccepted(text)
    || isIndustryQuoteOfferDeclined(text)
    || isQuoteConfirmation(text)
    || isQuoteRefresh(text)
    || isNewQuoteRequest(text)
    || isQuoteHistoryRequest(text)
    || isMenuRequest(text)
    || questionIntent !== null
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
    await sendReply(job, conversation, "Your Bridge-iT conversation is closed. We will not create a quote request from it.");
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

  if (conversation.aiLastQuestionKey === "QUOTE_OFFER" && isIndustryQuoteOfferDeclined(text)) {
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          aiStage: "COLLECTING",
          aiDraftEncrypted: null,
          aiDraftFingerprint: null,
          aiLastQuestionKey: null,
          aiUnproductiveTurns: 0,
        },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.INDUSTRY_QUOTE_OFFER_DECLINED",
        entityType: "Conversation",
        entityId: conversation.id,
        summary: "Customer declined an offer to begin a supplier quote request",
        metadata: { messageId: inbound.id },
      });
    });
    await sendReply(job, conversation, "No problem. If you would like prices later, just reply NEW QUOTE or describe what you need. I’m here when you’re ready.");
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
  const currentAttachmentAnalyses: QuoteAttachmentAnalysis[] = [];
  for (const message of mediaMessages) {
    const outcome = await persistMedia(message, conversation.id);
    const belongsToCurrentTurn = message.id === inbound.id || justConsented;
    rejectedMedia ||= outcome.rejected && belongsToCurrentTurn;
    if (outcome.attachment) {
      const analysis = await ensureAttachmentAnalysis(
        outcome.attachment,
        outcome.bytes,
        conversation.customerContact.phoneHash,
      );
      if (analysis) {
        const decision = attachmentAutomationDecision(analysis);
        if (decision.action === "EXCLUDE_AND_CONTINUE") {
          await excludeAttachmentAutomatically(outcome.attachment, analysis, {
            conversationId: conversation.id,
            jobId: job.id,
            messageId: message.id,
          });
          rejectedMedia ||= belongsToCurrentTurn;
          continue;
        }
        if (belongsToCurrentTurn) currentAttachmentCount += 1;
        if (belongsToCurrentTurn) currentAttachmentAnalyses.push(analysis);
      }
    }
  }

  const refreshed = await loadJob(job.id);
  if (!refreshed?.conversation) throw new Error("CONVERSATION_NOT_FOUND");
  const stage = refreshed.conversation.aiStage;
  const decryptedDraft = decryptDraft(refreshed.conversation.aiDraftEncrypted);
  let draft = decryptedDraft
    ? { ...decryptedDraft, categorySlug: normalizeLaunchCategorySlug(decryptedDraft.categorySlug) }
    : null;
  let beganWithoutDraft = !draft?.categorySlug;

  if (isConversationalHelpRequest(text)) {
    const savedDraft = draft?.title
      ? ` I still have your unfinished “${draft.title}” request safe. If this is a different job, just tell me the new item or service and I’ll keep the two requests separate.`
      : "";
    await sendReply(
      job,
      refreshed.conversation,
      `Yes — absolutely.${savedDraft}\n\nTell me what you need in your own words, or send a photo, drawing or PDF. Include where and when you need it if you can.`,
    );
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
      : "We haven’t found a currently confirmed supplier match yet. Bridge-iT is continuing to search and has recorded the coverage gap automatically.";
    await sendReply(job, refreshed.conversation, personaliseOpening(
      `Perfect — request ${request.request.reference} is live. ${distributionMessage} I’ll bring the available prices and lead times back here while keeping identities private. Reply QUOTES for an update, or NEW QUOTE whenever you have another job to price.`,
      preferredFirstName,
      true,
    ));
    return undefined;
  }

  if (stage === "QUOTE_CREATED" && isQuoteConfirmation(text)) {
    await sendReply(job, refreshed.conversation, await confirmedRequestReply(refreshed.conversation));
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
      include: {
        category: { include: { parent: true } },
        quotations: {
          where: { status: "SUBMITTED" },
          orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
          take: 5,
          include: { conversation: true },
        },
      },
    }));
    if (!request || !request.quotations.length) {
      await sendReply(job, refreshed.conversation, "That quote is no longer available. Reply QUOTES and I’ll show the latest prices and lead times.");
      return undefined;
    }
    if (questionIntent) {
      const moderation = moderatePreSelectionQuoteMessage(questionIntent.question);
      if (!moderation.allowed) {
        await runAsDatabaseWorker("whatsapp_ai", (tx) => writeWhatsAppAudit(tx, {
          action: "WHATSAPP.BUYER_QUESTION_BLOCKED",
          entityType: "QuoteRequest",
          entityId: request.id,
          summary: "A pre-selection buyer message containing contact details was blocked",
          metadata: { messageId: inbound.id, reasons: moderation.reasons },
        }));
        await sendReply(job, refreshed.conversation, "I can send product, specification, delivery and availability questions privately, but contact details and links stay protected until you select a quote. Please rewrite the question without a phone number, email, address, link or social handle.");
        return undefined;
      }
      const targets = questionIntent.kind === "ALL"
        ? request.quotations.filter((quotation) => quotation.conversation?.status === "OPEN")
        : request.quotations.filter((quotation) => quotation.conversation?.anonymousLabel === questionIntent.label && quotation.conversation.status === "OPEN");
      if (!targets.length) {
        await sendReply(job, refreshed.conversation, questionIntent.kind === "ALL"
          ? "There are no open supplier conversations for this request. Reply QUOTES to see the latest list."
          : `Quote ${questionIntent.label} is not available. Reply QUOTES to see the current quote letters.`);
        return undefined;
      }
      const broadcastKey = questionIntent.kind === "ALL" ? newBroadcastKey() : undefined;
      const result = await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
        const created: Array<{ label: string; dueAt: Date; isNew: boolean }> = [];
        for (const quotation of targets) {
          const quoteConversation = quotation.conversation!;
          const { message, created: questionCreated } = await createBuyerQuestion(tx, {
            conversationId: quoteConversation.id,
            body: questionIntent.question.slice(0, 2000),
            idempotencyKey: `buyer-question:${inbound.externalMessageId}:${quoteConversation.id}`,
            broadcastKey,
          });
          if (!questionCreated) {
            created.push({ label: quoteConversation.anonymousLabel, dueAt: message.questionDueAt!, isNew: false });
            continue;
          }
          const members = await tx.supplierTeamMembership.findMany({
            where: { supplierCompanyId: quotation.supplierCompanyId, status: "ACTIVE" },
            select: { userId: true },
          });
          if (members.length) {
            const preferences = await tx.notificationPreference.findMany({
              where: {
                supplierCompanyId: quotation.supplierCompanyId,
                userId: { in: members.map(({ userId }) => userId) },
              },
              select: { userId: true, inAppEnabled: true, emailQuotationUpdates: true },
            });
            const preferencesByUser = new Map(preferences.map((preference) => [preference.userId, preference]));
            const notificationRows = members.flatMap(({ userId }) => {
              const preference = preferencesByUser.get(userId);
              const rows = [];
              if (preference?.inAppEnabled !== false) {
                rows.push({
                  userId,
                  supplierCompanyId: quotation.supplierCompanyId,
                  type: "BUYER_QUESTION" as const,
                  channel: "IN_APP" as const,
                  title: `A buyer asked Quote ${quoteConversation.anonymousLabel} a question`,
                  body: "Reply privately in Bridge-iT. Contact details remain protected before selection.",
                  actionUrl: `/dashboard/requests/${request.reference}`,
                });
              }
              if (preference?.emailQuotationUpdates !== false) {
                rows.push({
                  userId,
                  supplierCompanyId: quotation.supplierCompanyId,
                  type: "BUYER_QUESTION" as const,
                  channel: "EMAIL" as const,
                  title: `Buyer question for ${request.reference}`,
                  body: `A buyer asked a private question about Quote ${quoteConversation.anonymousLabel}. Sign in to reply securely.`,
                  actionUrl: `/dashboard/requests/${request.reference}`,
                });
              }
              return rows;
            });
            if (notificationRows.length) {
              await tx.notification.createMany({ data: notificationRows });
            }
          }
          created.push({ label: quoteConversation.anonymousLabel, dueAt: message.questionDueAt!, isNew: true });
        }
        if (created.some(({ isNew }) => isNew)) {
          await writeWhatsAppAudit(tx, {
            action: questionIntent.kind === "ALL" ? "WHATSAPP.BUYER_QUESTION_BROADCAST" : "WHATSAPP.BUYER_QUESTION_SENT",
            entityType: "QuoteRequest",
            entityId: request.id,
            summary: questionIntent.kind === "ALL" ? "Buyer question sent privately to all available quoted suppliers" : "Buyer question sent to one anonymous quoted supplier",
            metadata: { messageId: inbound.id, labels: created.map(({ label }) => label), broadcastKey },
          });
        }
        return created;
      });
      await processSupplierEmailsSafely({ limit: 20 });
      const labels = result.map(({ label }) => `Quote ${label}`).join(", ");
      await sendReply(job, refreshed.conversation, questionIntent.kind === "ALL"
        ? `I’ve sent your question privately to ${labels}. Their identities stay hidden, and each reply will return here under the correct quote letter.`
        : `I’ve sent your question privately to Quote ${questionIntent.label}. Its reply will come back here under the same letter.`);
      return undefined;
    }
    if (!selectionIntent) {
      const questionHelp = quoteQuestionWhatsAppHelp({
        categorySlug: request.category.slug,
        parentSlug: request.category.parent?.slug,
      }, request.quotations[0]?.conversation?.anonymousLabel ?? "B");
      await sendReply(job, refreshed.conversation, request.quotations.length === 1
        ? `There is one quote available. Reply SELECT ${request.quotations[0]!.conversation?.anonymousLabel ?? "A"} and I’ll confirm that exact quote for you.\n\n${questionHelp}`
        : `Which quote would you like? Reply SELECT followed by its letter, for example SELECT B. To ask one supplier, reply ASK B followed by your question, or use ASK ALL.\n\n${questionHelp}`);
      return undefined;
    }
    if (selectionIntent.kind === "REFERENCE" && selectionIntent.reference !== request.reference.toUpperCase()) {
      await sendReply(job, refreshed.conversation, `That reference is not the quote list currently open. Reply QUOTES to see the latest prices for ${request.reference}.`);
      return undefined;
    }
    if (!["POSITION", "LABEL"].includes(selectionIntent.kind) && request.quotations.length > 1) {
      await sendReply(job, refreshed.conversation, `There are ${request.quotations.length} quotes available, so I haven’t selected one. Reply SELECT followed by the quote letter, for example SELECT B.`);
      return undefined;
    }
    const selected = selectionIntent.kind === "LABEL"
      ? request.quotations.find((quotation) => quotation.conversation?.anonymousLabel === selectionIntent.label)
      : request.quotations[(selectionIntent.kind === "POSITION" ? selectionIntent.position : 1) - 1];
    if (!selected) {
      await sendReply(job, refreshed.conversation, "That quote is not available. Reply QUOTES to see the current quote letters.");
      return undefined;
    }
    const selectedLabel = selected.conversation?.anonymousLabel ?? "A";
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
        metadata: { messageId: inbound.id, quoteRequestId: request.id, anonymousLabel: selectedLabel },
      });
    });
    await sendReply(job, refreshed.conversation, `Great choice — you’ve selected Quote ${selectedLabel} to move forward. This is not yet a confirmed booking or order. I’m sharing the supplier’s business contact details so you can agree the final arrangements.`);
    return undefined;
  }

  if (["QUOTE_CREATED", "SELECTION_RECORDED", "CLOSED"].includes(stage)) {
    await sendReply(job, refreshed.conversation, stage === "QUOTE_CREATED"
      ? "This request is live and safely stored. I’ll message you when supplier prices and lead times are ready. Reply NEW QUOTE to price another job, or MY QUOTES to see your recent requests."
      : "This quote is complete. Reply NEW QUOTE to price another job, or MY QUOTES to see your recent requests.");
    return undefined;
  }

  const categories: IntakeCategory[] = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.productCategory.findMany({
    where: launchedIntakeCategoryWhere(),
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: {
      slug: true, name: true, description: true,
      servesConsumer: true, servesTrade: true, servesBusiness: true,
      parent: { select: { slug: true, servesConsumer: true, servesTrade: true, servesBusiness: true } },
    },
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
        if (!isConsent(body)
          && !isCancelAllDraftsRequest(body)
          && !isCancelDraftRequest(body)
          && !isPreferredNameMessage) {
          parts.push({ direction: message.direction, text: body });
        }
      }
      for (const attachment of message.attachments) {
        if (["REJECTED", "FAILED"].includes(attachment.scanStatus)) continue;
        const analysis = decryptAttachmentAnalysis(attachment.aiSummaryEncrypted);
        if (analysis) parts.push({ direction: message.direction, text: attachmentContext(attachment.fileName, analysis) });
      }
      if (message.mediaIdEncrypted && !message.attachments.length) {
        parts.push({ direction: message.direction, text: `[Customer uploaded a ${message.messageType.toLowerCase()} file that is being processed.]` });
      }
      return parts;
    });
  const productRecognition = recogniseCatalogueProduct(text, categories);
  const currentIndustry = selectedIndustry(categories, draft?.categorySlug);
  if (draft?.categorySlug
    && currentIndustry
    && productRecognition
    && isClearCataloguePivot({
      text,
      recognition: productRecognition,
      currentCategorySlug: draft.categorySlug,
      currentIndustrySlug: currentIndustry.slug,
      expectedQuestionKey: refreshed.conversation.aiLastQuestionKey,
    })) {
    await startNewQuote(job, refreshed.conversation, inbound, false);
    const latestTurn = conversationPivotContext(messages, text);
    messages.splice(0, messages.length, ...latestTurn);
    draft = null;
    beganWithoutDraft = true;
    refreshed.conversation.aiDraftFingerprint = null;
    refreshed.conversation.aiLastQuestionKey = null;
    refreshed.conversation.aiUnproductiveTurns = 0;
  }
  const expectedQuestion = refreshed.conversation.aiLastQuestionKey;
  if (expectedQuestion === "REQUIRED_BY" && draft && !draft.requiredBy) {
    const resolvedDeadline = resolveCustomerDeadline(text, inbound.occurredAt);
    if (resolvedDeadline) {
      draft.requiredBy = resolvedDeadline;
      replaceLatestNumberedReply(
        messages,
        text,
        `[Customer deadline: ${new Date(resolvedDeadline).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}.]`,
      );
    }
  }
  if (expectedQuestion === "QUOTE_OFFER" && isIndustryQuoteOfferAccepted(text)) {
    replaceLatestNumberedReply(messages, text, "[Customer accepted the offer to find a competitive supplier quote.]");
  }
  let initialExtraction: Awaited<ReturnType<typeof extractQuoteIntake>> | null = null;
  if (!draft?.categorySlug) {
    const initialDraft = draft ?? emptyQuoteDraft();
    if (productRecognition) initialDraft.categorySlug = productRecognition.categorySlug;
    try {
      initialExtraction = await extractQuoteIntake({
        messages,
        currentDraft: initialDraft,
        categories,
        safetyIdentifier: refreshed.conversation.customerContact.phoneHash,
        referenceDate: inbound.occurredAt,
      });
    } catch (error) {
      if (!productRecognition) throw error;
      const recoveryIntent = productMessageIntent(text);
      const recoveryDraft = quoteDraftSchema.parse({
        ...initialDraft,
        categorySlug: productRecognition.categorySlug,
        title: recoveryIntent === "QUOTE_REQUEST" ? `${productRecognition.categoryName} request` : null,
        summary: recoveryIntent === "QUOTE_REQUEST" ? `Customer needs ${productRecognition.categoryName.toLocaleLowerCase("en-GB")}.` : null,
      });
      const recoveryFingerprint = quoteDraftFingerprint(recoveryDraft);
      await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
        await tx.conversation.update({
          where: { id: refreshed.conversation!.id },
          data: {
            aiStage: "COLLECTING",
            aiDraftEncrypted: encryptPrivateValue(JSON.stringify(recoveryDraft)),
            aiDraftFingerprint: recoveryFingerprint,
            aiLastQuestionKey: recoveryIntent === "QUESTION" ? "QUOTE_OFFER" : "REQUIREMENTS",
            aiUnproductiveTurns: 0,
            aiLastProgressAt: new Date(),
          },
        });
        await writeWhatsAppSystemEvent(tx, "whatsapp_ai", {
          severity: "WARNING",
          code: "WHATSAPP_PRODUCT_RECOVERY_USED",
          message: "Deterministic product recognition kept a customer conversation moving after an AI intake error",
          context: {
            conversationId: refreshed.conversation!.id,
            jobId: job.id,
            categorySlug: productRecognition.categorySlug,
            providerError: errorCode(error),
          },
        });
        await writeWhatsAppAudit(tx, {
          action: "WHATSAPP.PRODUCT_RECOVERY_USED",
          entityType: "Conversation",
          entityId: refreshed.conversation!.id,
          summary: "Recognised product enquiry answered without manual intervention after an AI intake error",
          metadata: {
            jobId: job.id,
            categorySlug: productRecognition.categorySlug,
            intent: recoveryIntent,
            providerError: errorCode(error),
          },
        });
      });
      const recoveryReply = productRecoveryReply(productRecognition, text);
      await sendReply(
        job,
        refreshed.conversation,
        personaliseOpening(
          recoveryIntent === "QUESTION" ? industryQuoteOfferReply(recoveryReply) : recoveryReply,
          preferredFirstName,
          true,
        ),
      );
      return undefined;
    }
    if (productRecognition) {
      initialExtraction.result.draft.categorySlug = productRecognition.categorySlug;
      initialExtraction.result.intent = productMessageIntent(text);
      if (initialExtraction.result.intent === "QUESTION" && !initialExtraction.result.reply.trim()) {
        initialExtraction.result.reply = productRecoveryReply(productRecognition, text);
      }
    }
    draft = initialExtraction.result.draft;
    if (!draft?.categorySlug) {
      if (initialExtraction.result.intent === "OTHER") {
        await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
          await tx.conversation.update({
            where: { id: refreshed.conversation!.id },
            data: {
              aiStage: "COLLECTING",
              aiDraftEncrypted: null,
              aiDraftFingerprint: null,
              aiLastQuestionKey: null,
              aiUnproductiveTurns: 0,
            },
          });
          await writeWhatsAppAudit(tx, {
            action: "WHATSAPP.UNSUPPORTED_UNIVERSAL_REQUEST_BLOCKED",
            entityType: "Conversation",
            entityId: refreshed.conversation!.id,
            summary: "A clear request outside the launched supplier network was not published",
            metadata: { jobId: job.id, launchedCategoryCount: categories.length },
          });
        });
        await sendReply(
          job,
          refreshed.conversation,
          "Bridge-iT does not yet have an approved supplier network for that request, so I won’t pretend I can source it. You can send a different request whenever you’re ready.",
        );
        return initialExtraction.telemetry;
      }
      const fingerprint = quoteDraftFingerprint(draft);
      await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
        await tx.conversation.update({
          where: { id: refreshed.conversation!.id },
          data: {
            aiStage: "COLLECTING",
            aiDraftEncrypted: encryptPrivateValue(JSON.stringify(draft)),
            aiDraftFingerprint: fingerprint,
            aiLastQuestionKey: "PRODUCT",
            aiUnproductiveTurns: 0,
          },
        });
        await writeWhatsAppAudit(tx, {
          action: "WHATSAPP.UNIVERSAL_REQUEST_DETAILS_REQUESTED",
          entityType: "Conversation",
          entityId: refreshed.conversation!.id,
          summary: "Customer was asked what they need without exposing an industry selector",
          metadata: { jobId: job.id, launchedCategoryCount: categories.length },
        });
      });
      await sendReply(job, refreshed.conversation, productSelectionPrompt());
      return undefined;
    }
  }

  const activeIndustry = selectedIndustry(categories, draft.categorySlug);
  if (!activeIndustry) {
    const unavailableCategorySlug = draft?.categorySlug ?? null;
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.conversation.update({
        where: { id: refreshed.conversation!.id },
        data: {
          aiStage: "COLLECTING",
          aiDraftEncrypted: null,
          aiDraftFingerprint: null,
          aiLastQuestionKey: "PRODUCT",
          aiUnproductiveTurns: 0,
        },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.UNAVAILABLE_DRAFT_INDUSTRY_CLEARED",
        entityType: "Conversation",
        entityId: refreshed.conversation!.id,
        summary: "An unfinished draft was cleared after its industry became unavailable",
        metadata: { jobId: job.id, unavailableCategorySlug },
      });
    });
    await sendReply(
      job,
      refreshed.conversation,
      `That request is not in a category currently open for supplier matching, so I’ve safely cleared the unfinished draft. No confirmed request was changed.\n\n${universalRequestPrompt()}`,
    );
    return undefined;
  }
  const intakeCategories = categories.filter((category) => (
    category.slug === activeIndustry?.slug || category.parent?.slug === activeIndustry?.slug
  ));
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
  const { result, telemetry } = initialExtraction ?? await extractQuoteIntake({
    messages,
    currentDraft: draft,
    categories: intakeCategories,
    safetyIdentifier: refreshed.conversation.customerContact.phoneHash,
    referenceDate: inbound.occurredAt,
  });
  if (result.intent === "QUESTION") {
    if (!beganWithoutDraft || !initialExtraction) {
      await sendReply(job, refreshed.conversation, result.reply);
      return telemetry;
    }
    const offerFingerprint = quoteDraftFingerprint(result.draft);
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.conversation.update({
        where: { id: refreshed.conversation!.id },
        data: {
          aiStage: "COLLECTING",
          aiDraftEncrypted: encryptPrivateValue(JSON.stringify(result.draft)),
          aiDraftFingerprint: offerFingerprint,
          aiLastQuestionKey: "QUOTE_OFFER",
          aiUnproductiveTurns: 0,
          aiLastProgressAt: new Date(),
        },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.INDUSTRY_QUOTE_OFFERED",
        entityType: "Conversation",
        entityId: refreshed.conversation!.id,
        summary: "Bridge-iT recognised an industry question and offered trusted supplier quotes",
        metadata: {
          jobId: job.id,
          categorySlug: result.draft.categorySlug,
        },
      });
    });
    await sendReply(
      job,
      refreshed.conversation,
      personaliseOpening(industryQuoteOfferReply(result.reply), preferredFirstName, true),
    );
    return telemetry;
  }
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
    await sendReply(job, refreshed.conversation, "I can’t safely complete this request automatically. A Bridge-iT administrator will need to review it.");
    return telemetry;
  }
  const compositeDoorPhoto = compositeDoorPhotoDecision(result.draft, messages);
  result.draft.buyerType = result.draft.buyerType ?? classifyBuyerType(text)
    ?? classifyBuyerType(messages.filter((message) => message.direction === "INBOUND").map((message) => message.text).join("\n"));
  const roofGlazingSpecification = roofGlazingSpecificationDecision(result.draft, messages);
  const pheSpecification = pheSpecificationDecision(result.draft, messages);
  const transportIntake = transportIntakeDecision(result.draft, messages);
  const hyperlocalIntake = hyperlocalServiceIntakeDecision(result.draft, messages);
  if (transportIntake.isTransport) {
    result.draft.fulfilmentMode = "SERVICE";
    result.draft.collectionRequired = false;
    result.tradeClarification = { materialNeeded: false, colourNeeded: false, colourTerm: null };
  }
  if (hyperlocalIntake.isHyperlocalService) {
    result.draft.fulfilmentMode = "SERVICE";
    result.draft.collectionRequired = false;
    result.tradeClarification = { materialNeeded: false, colourNeeded: false, colourTerm: null };
  }
  const category = result.draft.categorySlug ? categories.find((item) => item.slug === result.draft.categorySlug) : undefined;
  const industry = category?.parent ?? category;
  if (industry && result.draft.buyerType && !buyerTypeAllowed(result.draft.buyerType, industry)) {
    result.readyForConfirmation = false;
    result.reply = `Bridge-iT does not currently match ${buyerTypeLabel(result.draft.buyerType).toLocaleLowerCase("en-GB")} requests for this industry. I have not shared this request with suppliers.`;
    result.nextQuestionKey = "NONE";
  }
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
          : transportIntake.shouldAsk
            ? transportIntake.nextQuestionKey!
            : hyperlocalIntake.shouldAsk
              ? "HYPERLOCAL_SERVICE"
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
          aiStage: "COLLECTING",
          aiDraftEncrypted: encryptPrivateValue(JSON.stringify(result.draft)),
          aiDraftFingerprint: fingerprint,
          aiLastQuestionKey: questionKey,
          aiUnproductiveTurns: 0,
        },
      });
      await writeWhatsAppSystemEvent(tx, "whatsapp_ai", {
        severity: "WARNING",
        code: "CUSTOMER_INTAKE_STALLED",
        message: "A stalled WhatsApp quote intake was automatically reset to a clearer question",
        context: { conversationId: refreshed.conversation!.id, jobId: job.id, questionKey },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.INTAKE_AUTOMATICALLY_RECOVERED",
        entityType: "Conversation",
        entityId: refreshed.conversation!.id,
        summary: "Stalled WhatsApp quote intake automatically repeated a clearer request",
        metadata: { jobId: job.id, questionKey, unproductiveTurns: progress.unproductiveTurns },
      });
    });
    await sendReply(
      job,
      refreshed.conversation,
      `I want to make sure I get this right without holding you up. ${questionKey === "PRODUCT" ? productQuestionForCategory(result.draft.categorySlug) : conversationalRecoveryPrompt(questionKey)}`,
    );
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
    .reduce((count, message) => count + message.attachments.filter(
      (attachment) => !["REJECTED", "FAILED"].includes(attachment.scanStatus),
    ).length, 0);
  const mediaAcknowledgement = currentAttachmentCount > 0
    ? attachmentInterpretation(currentAttachmentAnalyses.map((analysis) => analysis.summary))
      ?? `I’ve securely received and read ${currentAttachmentCount === 1 ? "that file" : `those ${currentAttachmentCount} files`} and added the useful details.`
    : null;
  const productQuestionPrompt = !ready && questionKey === "PRODUCT"
    ? productQuestionForCategory(result.draft.categorySlug)
    : null;
  const repeatedClarification = !ready && progress.repeatedQuestion && !progress.progressed
    ? questionKey === "PRODUCT"
      ? productQuestionForCategory(result.draft.categorySlug)
      : conversationalRecoveryPrompt(questionKey)
    : null;
  const tradeClarification = !ready && questionKey === "SPECIFICATION"
    ? tradeSpecificationClarification(result.tradeClarification, result.draft.items[0]?.description)
    : null;
  const enforcedClarification = !ready && questionKey !== result.nextQuestionKey
    ? questionKey === "PRODUCT"
      ? productQuestionForCategory(result.draft.categorySlug)
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
      : `${mediaAcknowledgement ? `${mediaAcknowledgement}\n\n` : ""}${compositeDoorPhoto.shouldAsk ? compositeDoorStylePhotoPrompt() : roofGlazingSpecification.shouldAsk ? roofGlazingSpecificationPrompt(roofGlazingSpecification) : pheSpecification.shouldAsk ? pheSpecificationPrompt(pheSpecification.categorySlug) : transportIntake.shouldAsk ? transportIntakePrompt(transportIntake) : hyperlocalIntake.shouldAsk ? hyperlocalIntake.prompt : tradeClarification ?? productQuestionPrompt ?? repeatedClarification ?? enforcedClarification ?? result.reply}${rejectedMedia ? "\n\nI couldn’t use one uploaded file for this quote, so I’ve safely left it out. Send another JPG, PNG or PDF, or describe the job here and I’ll keep going." : ""}`;
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
    include: {
      category: { include: { parent: true } },
      quotations: { where: { status: "SUBMITTED" }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 5, include: { conversation: true } },
    },
  }));
  if (!request) return null;
  const quotes = request.quotations.filter((quote) => !quote.validUntil || quote.validUntil > new Date());
  if (!quotes.length) return null;
  const lines = quotes.map((quote, index) => {
    const label = quote.conversation?.anonymousLabel ?? ["A", "B", "C", "D", "E"][index]!;
    const delivery = quote.deliveryCost === null ? "delivery not stated" : Number(quote.deliveryCost) === 0 ? "delivery included" : `${formatPrice(quote.deliveryCost, quote.currency)} delivery`;
    return `Quote ${label}: ${formatPrice(quote.price, quote.currency)} — ${quote.leadTimeDays} day${quote.leadTimeDays === 1 ? "" : "s"} — ${delivery}`;
  });
  const firstLabel = quotes[0]!.conversation?.anonymousLabel ?? "A";
  const questionHelp = quoteQuestionWhatsAppHelp({
    categorySlug: request.category.slug,
    parentSlug: request.category.parent?.slug,
  }, firstLabel);
  return {
    requestId: request.id,
    reference: request.reference,
    quoteCount: quotes.length,
    lines,
    body: [
      `Current prices for ${request.reference}. Supplier identities remain private:`,
      lines.join("\n"),
      quotes.length === 1
        ? `To choose this quote, reply SELECT ${firstLabel}. To ask a question, reply ASK ${firstLabel} followed by your question.`
        : "To choose, reply SELECT followed by its letter, for example SELECT B. To ask one supplier, reply ASK B followed by your question, or use ASK ALL.",
      questionHelp,
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
    `You selected a supplier to move forward for ${loaded.quoteRequest.reference}. The booking or order is not confirmed until you and the supplier agree the final arrangements.`,
    `Supplier: ${supplierName}`,
    `Email: ${supplier.contactEmail}`,
    `Phone: ${supplier.contactPhone}`,
    "Use these details only for this enquiry. Bridge-iT does not take card or bank details in WhatsApp.",
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

async function processQuoteMessage(job: WhatsAppJob, loaded: LoadedJob) {
  if (!loaded.conversation || !loaded.quoteRequest || !loaded.quoteMessage) throw new Error("QUOTE_MESSAGE_JOB_INVALID");
  if (loaded.quoteMessage.sender !== "SUPPLIER" || loaded.quoteMessage.status === "BLOCKED") return undefined;
  const body = decryptPrivateValue(loaded.quoteMessage.contentEncrypted);
  const label = loaded.quoteMessage.quoteConversation.anonymousLabel;
  await sendReply(job, loaded.conversation, `Quote ${label} replied:\n\n${body}\n\nSupplier identity and contact details remain private until you select a quote.`);
  await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.quoteMessage.update({ where: { id: loaded.quoteMessage!.id }, data: { status: "DELIVERED", deliveredAt: new Date() } });
    if (loaded.quoteMessage!.replyToId) {
      await tx.quoteMessage.updateMany({
        where: { id: loaded.quoteMessage!.replyToId, sender: "BUYER", answeredAt: null },
        data: { answeredAt: new Date() },
      });
    }
    await writeWhatsAppAudit(tx, { action: "WHATSAPP.QUOTE_MESSAGE_DELIVERED", entityType: "QuoteMessage", entityId: loaded.quoteMessage!.id, summary: "Private supplier response delivered to the correct customer", metadata: { quoteRequestId: loaded.quoteRequest!.id, anonymousLabel: label } });
  });
  return undefined;
}

async function processIntakeFallback(job: WhatsAppJob, loaded: LoadedJob) {
  if (!loaded.conversation) throw new Error("INTAKE_FALLBACK_INVALID");
  const recovery = intakeFailureRecovery(loaded.conversation.aiStage);
  await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.conversation.update({
      where: { id: loaded.conversation!.id },
      data: recovery.preserveStage
        ? { aiUnproductiveTurns: 0 }
        : { aiStage: "COLLECTING", aiUnproductiveTurns: 0 },
    });
    await writeWhatsAppSystemEvent(tx, "whatsapp_ai", {
      severity: "ERROR",
      code: "CUSTOMER_INTAKE_FALLBACK",
      message: "A customer was given an automatic recovery prompt after terminal WhatsApp intake failure",
      context: { conversationId: loaded.conversation!.id, jobId: job.id },
    });
    await writeWhatsAppAudit(tx, {
      action: "WHATSAPP.INTAKE_FALLBACK_QUEUED",
      entityType: "Conversation",
      entityId: loaded.conversation!.id,
      summary: recovery.summary,
      metadata: { jobId: job.id, previousStage: loaded.conversation!.aiStage, stagePreserved: recovery.preserveStage },
    });
  });
  await sendReply(job, loaded.conversation, recovery.body);
  return undefined;
}

async function processJob(job: WhatsAppJob) {
  const loaded = await loadJob(job.id);
  if (!loaded) throw new Error("JOB_NOT_FOUND");
  if (job.type === "PROCESS_INBOUND") return processInbound(job, loaded);
  if (job.type === "SEND_INTAKE_FALLBACK") return processIntakeFallback(job, loaded);
  if (job.type === "SEND_QUOTE_SUMMARY") return processQuoteSummary(job, loaded);
  if (job.type === "SEND_CONTACT_UNLOCK") return processContactUnlock(job, loaded);
  if (job.type === "SEND_QUOTE_MESSAGE") return processQuoteMessage(job, loaded);
  throw new Error("JOB_TYPE_UNSUPPORTED");
}

export async function enqueueQuoteSummary(quotationId: string) {
  return runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    const quotation = await tx.supplierQuotation.findUnique({
      where: { id: quotationId }, include: { quoteRequest: true },
    });
    if (!quotation?.quoteRequest.conversationId || quotation.status !== "SUBMITTED") return null;
    // Each newly submitted quotation may change the customer's numbered list.
    // Keying the job to the quotation refreshes that list once per supplier quote,
    // while retries of the same submission remain idempotent.
    const idempotencyKey = `quote-summary:${quotation.quoteRequestId}:quotation:${quotation.id}`;
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

export async function processWhatsAppJobs({
  limit = 5,
  concurrency = 3,
  flushSupplierEmails = true,
}: {
  limit?: number;
  concurrency?: number;
  flushSupplierEmails?: boolean;
} = {}) {
  let processed = 0;
  let claimed = 0;
  let terminalFailure = false;
  let retryPending = false;
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const safeConcurrency = Math.max(1, Math.min(5, Math.floor(concurrency)));

  async function worker() {
    while (claimed < safeLimit) {
      claimed += 1;
      const job = await claimJob();
      if (!job) return;
      try {
        const telemetry = await processJob(job);
        await completeJob(job, telemetry);
        processed += 1;
      } catch (error) {
        console.error("WhatsApp job processing failed", { jobId: job.id, type: job.type, errorCode: errorCode(error) });
        const terminal = await failJob(job, error);
        terminalFailure = terminal || terminalFailure;
        retryPending = !terminal || retryPending;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(safeConcurrency, safeLimit) }, () => worker()));
  if (processed > 0 && flushSupplierEmails) {
    await processSupplierEmailsSafely({ limit: Math.min(50, Math.max(10, processed * 5)) });
  }
  if (terminalFailure) await runProductionMonitoringSafely();

  // Vercel does not guarantee that another webhook will arrive to wake a delayed
  // retry. Give transient failures one short in-request retry, while the cron
  // worker remains the durable recovery path for longer provider incidents.
  if (retryPending) {
    await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS + 250));
    processed += await processWhatsAppJobs({
      limit: Math.min(5, safeLimit),
      concurrency: 1,
      flushSupplierEmails: false,
    });
  }

  return processed;
}
