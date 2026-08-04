import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type WhatsAppJob } from "@prisma/client";
import { applicationOrigin, metaContactTemplate, metaQuoteTemplate, whatsappConciergeConfig } from "@/lib/config";
import { runAsDatabaseWorker } from "@/lib/db";
import { extractQuoteIntake, quoteDraftSchema, type QuoteDraft } from "@/lib/ai/quote-intake";
import { lookupPostcode } from "@/lib/location/postcodes";
import { addSupplierResponseHours } from "@/lib/quotes/response-clock";
import { selectQuotationForCustomer } from "@/lib/quotes/selection";
import { decryptPrivateValue, encryptPrivateValue } from "@/lib/security/encryption";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PRIVATE_BUCKET } from "@/lib/storage";
import { downloadMetaMedia, sendMetaTemplate, sendMetaText } from "@/lib/whatsapp/meta-client";

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
    await tx.whatsAppJob.updateMany({
      where: { status: "PROCESSING", lockedAt: { lt: staleBefore }, attempts: { lt: MAX_ATTEMPTS } },
      data: { status: "PENDING", lockedAt: null, availableAt: new Date() },
    });
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM bridge_ai."WhatsAppJob"
      WHERE status = 'PENDING'
        AND "availableAt" <= now()
        AND attempts < ${MAX_ATTEMPTS}
      ORDER BY "createdAt" ASC
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
          messages: { orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 20 },
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
      await tx.systemEvent.create({
        data: {
          severity: "ERROR",
          source: "whatsapp_ai",
          code: "WHATSAPP_JOB_FAILED",
          message: "A WhatsApp background job exhausted its safe retry policy",
          context: { jobId: job.id, jobType: job.type, errorCode: code, attempts: job.attempts },
        },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.JOB_FAILED",
        entityType: "WhatsAppJob",
        entityId: job.id,
        summary: "WhatsApp background job failed",
        metadata: { type: job.type, errorCode: code, attempts: job.attempts },
      });
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
  const lastInboundAt = conversation.messages
    .filter((message) => message.direction === "INBOUND")
    .reduce<Date | null>((latest, message) => !latest || message.occurredAt > latest ? message.occurredAt : latest, null);
  const serviceWindowOpen = Boolean(lastInboundAt && Date.now() - lastInboundAt.getTime() < 24 * 60 * 60_000);
  if (!serviceWindowOpen && !options?.outOfWindowTemplate) {
    throw new Error(options?.missingTemplateCode ?? "META_QUOTE_TEMPLATE_REQUIRED");
  }
  const localMessageId = `queued:${job.id}:${job.attempts}`;
  const existing = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.whatsAppMessage.findUnique({
    where: { externalMessageId: localMessageId },
  }));
  if (existing?.status === "QUEUED") throw new Error("OUTBOUND_DELIVERY_UNCERTAIN");

  const queued = await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
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
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.whatsAppMessage.updateMany({
        where: { id: queued.id, status: "QUEUED" },
        data: { status: "FAILED", failureCode: errorCode(error), failureMessage: "Outbound delivery failed" },
      });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.MESSAGE_SEND_FAILED",
        entityType: "WhatsAppMessage",
        entityId: queued.id,
        summary: "Outbound WhatsApp reply failed",
        metadata: { jobId: job.id, errorCode: errorCode(error) },
      });
    });
    throw error;
  }
}

async function persistMedia(message: LoadedJob["whatsappMessage"], conversationId: string) {
  if (!message?.mediaIdEncrypted) return { stored: false, rejected: false };
  const existing = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.attachment.findFirst({
    where: { whatsappMessageId: message.id }, select: { id: true },
  }));
  if (existing) return { stored: true, rejected: false };
  if (message.messageType === "AUDIO") return { stored: false, rejected: true };

  const mediaId = decryptPrivateValue(message.mediaIdEncrypted);
  const hintedName = message.mediaFileNameEncrypted ? decryptPrivateValue(message.mediaFileNameEncrypted) : undefined;
  let downloaded: Awaited<ReturnType<typeof downloadMetaMedia>>;
  try {
    downloaded = await downloadMetaMedia(mediaId, hintedName);
  } catch (error) {
    if (["META_MEDIA_TYPE_REJECTED", "META_MEDIA_TOO_LARGE"].includes(errorCode(error))) {
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
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
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
    });
  } catch (error) {
    await storage.remove([storageKey]).catch(() => undefined);
    throw error;
  }
  return { stored: true, rejected: false };
}

function decryptDraft(value: Uint8Array | null) {
  if (!value) return null;
  return quoteDraftSchema.parse(JSON.parse(decryptPrivateValue(value)));
}

function consentReply() {
  const origin = process.env.APP_URL?.trim();
  const privacyUrl = origin ? `${applicationOrigin(origin)}/legal/privacy` : "/legal/privacy";
  return [
    "I’m Bridge AI, an automated assistant from Ironbridge Group Ltd.",
    "I can collect the details and files needed to request quotes from approved suppliers. Your contact details stay private until you accept a quote and the selected supplier completes the unlock payment.",
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

export function formatConfirmation(draft: QuoteDraft, categoryName: string) {
  const items = draft.items.map((item, index) => `${index + 1}. ${item.quantity} ${item.unit} — ${item.description}`).join("\n");
  return [
    "Please check your quote request:",
    `Project: ${draft.title}`,
    `Category: ${categoryName}`,
    `Delivery: ${draft.deliveryPostcode}`,
    `Requirements: ${draft.summary}`,
    items,
    draft.customerBudget === null ? null : `Budget: £${draft.customerBudget.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`,
    "Reply CONFIRM to send this request, or tell me what to change.",
  ].filter(Boolean).join("\n\n");
}

export function draftIsComplete(draft: QuoteDraft) {
  return Boolean(draft.deliveryPostcode && draft.categorySlug && draft.title && draft.summary && draft.items.length > 0);
}

async function createQuoteRequest(job: WhatsAppJob, loaded: LoadedJob, draft: QuoteDraft) {
  if (!loaded.conversation) throw new Error("CONVERSATION_NOT_FOUND");
  const category = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.productCategory.findUnique({
    where: { slug: draft.categorySlug ?? "" }, select: { id: true, name: true, active: true },
  }));
  if (!category?.active || !draftIsComplete(draft)) throw new Error("QUOTE_DRAFT_INCOMPLETE");
  const delivery = await lookupPostcode(draft.deliveryPostcode!);
  const now = new Date();
  const { quoteResponseHours, distributionLimit } = whatsappConciergeConfig();
  const reference = `BA-${now.getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`;
  return runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    const request = await tx.quoteRequest.create({
      data: {
        reference,
        conversationId: loaded.conversation!.id,
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
    await tx.attachment.updateMany({
      where: { quoteRequestId: null, whatsappMessage: { conversationId: loaded.conversation!.id } },
      data: { quoteRequestId: request.id },
    });
    await tx.conversation.update({ where: { id: loaded.conversation!.id }, data: { aiStage: "QUOTE_CREATED" } });
    await writeWhatsAppAudit(tx, {
      action: "WHATSAPP.QUOTE_REQUEST_CREATED",
      entityType: "QuoteRequest",
      entityId: request.id,
      summary: "Customer-confirmed WhatsApp quote request created",
      metadata: { jobId: job.id, reference, categoryId: category.id, itemCount: draft.items.length, distributionLimit },
    });
    return request;
  });
}

async function processInbound(job: WhatsAppJob, loaded: LoadedJob) {
  const conversation = loaded.conversation;
  const inbound = loaded.whatsappMessage;
  if (!conversation || !inbound || inbound.direction !== "INBOUND") throw new Error("INBOUND_JOB_INVALID");
  const text = inbound.bodyEncrypted ? decryptPrivateValue(inbound.bodyEncrypted) : "";

  if (isStop(text)) {
    await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.conversation.update({
      where: { id: conversation.id }, data: { aiStage: "CLOSED", closedAt: new Date(), aiDraftEncrypted: null },
    }));
    await sendReply(job, conversation, "Your Bridge AI conversation is closed. We will not create a quote request from it.");
    return undefined;
  }

  if (!conversation.aiConsentAt) {
    if (!isConsent(text)) {
      await sendReply(job, conversation, consentReply());
      return undefined;
    }
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.conversation.update({ where: { id: conversation.id }, data: { aiConsentAt: new Date(), aiStage: "COLLECTING" } });
      await writeWhatsAppAudit(tx, {
        action: "WHATSAPP.AI_CONSENT_RECORDED",
        entityType: "Conversation",
        entityId: conversation.id,
        summary: "Customer consented to automated WhatsApp quote intake",
        metadata: { messageId: inbound.id },
      });
    });
  }

  const mediaMessages = conversation.messages.filter((message) => message.mediaIdEncrypted && message.direction === "INBOUND");
  let rejectedMedia = false;
  for (const message of mediaMessages) {
    const outcome = await persistMedia(message, conversation.id);
    rejectedMedia ||= outcome.rejected;
  }

  const refreshed = await loadJob(job.id);
  if (!refreshed?.conversation) throw new Error("CONVERSATION_NOT_FOUND");
  const stage = refreshed.conversation.aiStage;
  const draft = decryptDraft(refreshed.conversation.aiDraftEncrypted);

  if (stage === "AWAITING_CONFIRMATION" && isConfirmation(text)) {
    if (!draft) throw new Error("QUOTE_DRAFT_MISSING");
    const request = await createQuoteRequest(job, refreshed, draft);
    await sendReply(job, refreshed.conversation, `Thanks — request ${request.reference} is now live. Up to five approved suppliers can quote. I’ll send their prices and lead times here without revealing identities.`);
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
      ? "Your request is live. I’ll message you here when supplier quotes are ready."
      : "This quote workflow is already complete. A Bridge AI administrator can help if you need anything changed.");
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
    .flatMap((message) => message.bodyEncrypted
      ? [{ direction: message.direction, text: decryptPrivateValue(message.bodyEncrypted) }]
      : message.mediaIdEncrypted
        ? [{ direction: message.direction, text: `[Customer uploaded a ${message.messageType.toLowerCase()} file; content is not available to the AI until security scanning completes.]` }]
        : []);
  const { result, telemetry } = await extractQuoteIntake({
    messages,
    currentDraft: draft,
    categories,
    safetyIdentifier: refreshed.conversation.customerContact.phoneHash,
  });
  if (result.needsHumanReview) {
    await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.conversation.update({ where: { id: refreshed.conversation!.id }, data: { aiStage: "HUMAN_REVIEW", aiDraftEncrypted: encryptPrivateValue(JSON.stringify(result.draft)) } });
      await tx.systemEvent.create({ data: { severity: "WARNING", source: "whatsapp_ai", code: "CUSTOMER_CONVERSATION_REVIEW", message: "A WhatsApp conversation requires administrator review", context: { conversationId: refreshed.conversation!.id, jobId: job.id } } });
    });
    await sendReply(job, refreshed.conversation, "I can’t safely complete this request automatically. A Bridge AI administrator will need to review it.");
    return telemetry;
  }
  const ready = result.readyForConfirmation && draftIsComplete(result.draft);
  const category = result.draft.categorySlug ? categories.find((item) => item.slug === result.draft.categorySlug) : undefined;
  await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.conversation.update({
      where: { id: refreshed.conversation!.id },
      data: {
        aiStage: ready ? "AWAITING_CONFIRMATION" : "COLLECTING",
        aiDraftEncrypted: encryptPrivateValue(JSON.stringify(result.draft)),
      },
    });
    await writeWhatsAppAudit(tx, {
      action: "WHATSAPP.AI_DRAFT_UPDATED",
      entityType: "Conversation",
      entityId: refreshed.conversation!.id,
      summary: "Encrypted WhatsApp quote draft updated",
      metadata: { jobId: job.id, readyForConfirmation: ready, itemCount: result.draft.items.length },
    });
  });
  const reply = ready && category
      ? formatConfirmation(result.draft, category.name)
      : `${result.reply}${rejectedMedia ? "\n\nOne uploaded file could not be accepted. Please send a JPG, PNG or PDF within the size limit." : ""}`;
  await sendReply(job, refreshed.conversation, reply);
  return telemetry;
}

function formatPrice(value: Prisma.Decimal, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(value));
}

async function processQuoteSummary(job: WhatsAppJob, loaded: LoadedJob) {
  if (!loaded.conversation || !loaded.quoteRequest || !loaded.quotation) throw new Error("QUOTE_SUMMARY_JOB_INVALID");
  const request = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.quoteRequest.findUnique({
    where: { id: loaded.quoteRequest!.id },
    include: { quotations: { where: { status: "SUBMITTED" }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 5 } },
  }));
  if (!request || !["OPEN", "MATCHING", "QUOTED"].includes(request.status)) return undefined;
  const quotes = request.quotations.filter((quote) => !quote.validUntil || quote.validUntil > new Date());
  if (!quotes.length) return undefined;
  const lines = quotes.map((quote, index) => `Quote ${index + 1}: ${formatPrice(quote.price, quote.currency)} — lead time ${quote.leadTimeDays} day${quote.leadTimeDays === 1 ? "" : "s"}`);
  const body = [
    `New prices are available for ${request.reference}. Supplier identities remain private:`,
    lines.join("\n"),
    "Reply ACCEPT followed by the quote number, for example ACCEPT 1. Contact details remain locked until the selected supplier pays the £25 success fee.",
  ].join("\n\n");
  const template = metaQuoteTemplate();
  await sendReply(job, loaded.conversation, body, template ? {
    outOfWindowTemplate: {
      ...template,
      parameters: [request.reference, lines.join("\n")],
    },
  } : undefined);
  await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.conversation.update({ where: { id: loaded.conversation!.id }, data: { aiStage: "AWAITING_SELECTION" } });
    await tx.quoteRequest.updateMany({ where: { id: request.id, status: { in: ["OPEN", "MATCHING"] } }, data: { status: "QUOTED" } });
    await writeWhatsAppAudit(tx, {
      action: "WHATSAPP.QUOTE_SUMMARY_SENT",
      entityType: "QuoteRequest",
      entityId: request.id,
      summary: "Anonymised supplier prices and lead times sent to customer",
      metadata: { jobId: job.id, quoteCount: quotes.length },
    });
  });
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

async function processJob(job: WhatsAppJob) {
  const loaded = await loadJob(job.id);
  if (!loaded) throw new Error("JOB_NOT_FOUND");
  if (job.type === "PROCESS_INBOUND") return processInbound(job, loaded);
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
    return tx.whatsAppJob.upsert({
      where: { idempotencyKey: `quote-summary:${quotation.id}:${quotation.updatedAt.getTime()}` },
      create: {
        type: "SEND_QUOTE_SUMMARY",
        idempotencyKey: `quote-summary:${quotation.id}:${quotation.updatedAt.getTime()}`,
        conversationId: quotation.quoteRequest.conversationId,
        quoteRequestId: quotation.quoteRequestId,
        quotationId: quotation.id,
      },
      update: {},
    });
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
