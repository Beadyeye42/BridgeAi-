import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { metaWebhookCredentials } from "@/lib/config";
import { trustedPrisma } from "@/lib/db";
import { blindIndex, encryptPrivateValue } from "@/lib/security/encryption";
import {
  MAX_META_WEBHOOK_BYTES,
  metaEventDigest,
  parseMetaWebhook,
  verifyMetaSignature,
  verifyMetaToken,
} from "@/lib/whatsapp/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER = "META_WHATSAPP";

function unavailable() {
  return NextResponse.json({ error: "Webhook unavailable" }, { status: 503 });
}

export async function GET(request: Request) {
  let verifyToken: string;
  try {
    ({ verifyToken } = metaWebhookCredentials());
  } catch {
    return unavailable();
  }

  const query = new URL(request.url).searchParams;
  const valid = query.get("hub.mode") === "subscribe"
    && verifyMetaToken(query.get("hub.verify_token"), verifyToken);
  const challenge = query.get("hub.challenge");
  if (!valid || challenge === null) {
    return NextResponse.json({ error: "Verification failed" }, { status: 403 });
  }
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function statusMutation(status: ReturnType<typeof parseMetaWebhook>["statuses"][number]) {
  if (status.status === "DELIVERED") return { status: "DELIVERED" as const, deliveredAt: status.occurredAt };
  if (status.status === "READ") return { status: "READ" as const, readAt: status.occurredAt };
  if (status.status === "FAILED") {
    return {
      status: "FAILED" as const,
      failureCode: status.failureCode,
      failureMessage: "Meta reported a message delivery failure",
    };
  }
  return { status: "SENT" as const };
}

async function recordProcessingFailure(externalEventId: string, summary: Prisma.InputJsonValue) {
  await trustedPrisma.$transaction(async (tx) => {
    const event = await tx.webhookEvent.upsert({
      where: { provider_externalEventId: { provider: PROVIDER, externalEventId } },
      create: {
        provider: PROVIDER,
        externalEventId,
        eventType: "whatsapp.messages",
        payload: summary,
        failedAt: new Date(),
        failureReason: "PROCESSING_FAILED",
      },
      update: {
        failedAt: new Date(),
        failureReason: "PROCESSING_FAILED",
        retryCount: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        action: "WHATSAPP.WEBHOOK_FAILED",
        entityType: "WebhookEvent",
        entityId: event.id,
        summary: "Verified WhatsApp webhook processing failed",
        metadata: { externalEventId },
      },
    });
  });
}

export async function POST(request: Request) {
  let appSecret: string;
  try {
    ({ appSecret } = metaWebhookCredentials());
  } catch {
    return unavailable();
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_META_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.byteLength > MAX_META_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const externalEventId = metaEventDigest(rawBody);
  let parsed: ReturnType<typeof parseMetaWebhook>;
  try {
    parsed = parseMetaWebhook(JSON.parse(Buffer.from(rawBody).toString("utf8")));
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await trustedPrisma.$transaction(async (tx) => {
      const existing = await tx.webhookEvent.findUnique({
        where: { provider_externalEventId: { provider: PROVIDER, externalEventId } },
        select: { processedAt: true },
      });
      if (existing?.processedAt) return { duplicate: true };

      const event = existing
        ? await tx.webhookEvent.update({
            where: { provider_externalEventId: { provider: PROVIDER, externalEventId } },
            data: { failedAt: null, failureReason: null },
          })
        : await tx.webhookEvent.create({
            data: {
              provider: PROVIDER,
              externalEventId,
              eventType: "whatsapp.messages",
              payload: parsed.summary,
            },
          });

      for (const message of [...parsed.messages].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
        const alreadyStored = await tx.whatsAppMessage.findUnique({
          where: { externalMessageId: message.externalMessageId },
          select: { id: true },
        });
        if (alreadyStored) continue;

        const phoneHash = blindIndex(message.from);
        const displayNameEncrypted = message.displayName ? encryptPrivateValue(message.displayName) : undefined;
        const contact = await tx.customerContact.upsert({
          where: { phoneHash },
          create: {
            phoneHash,
            phoneEncrypted: encryptPrivateValue(message.from),
            displayNameEncrypted,
          },
          update: displayNameEncrypted ? { displayNameEncrypted } : {},
        });
        const conversation = await tx.conversation.upsert({
          where: { externalConversationId: `wa:${phoneHash}` },
          create: {
            customerContactId: contact.id,
            externalConversationId: `wa:${phoneHash}`,
            lastMessageAt: message.occurredAt,
          },
          update: {},
        });
        await tx.conversation.updateMany({
          where: {
            id: conversation.id,
            OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: message.occurredAt } }],
          },
          data: { lastMessageAt: message.occurredAt },
        });
        const stored = await tx.whatsAppMessage.create({
          data: {
            conversationId: conversation.id,
            externalMessageId: message.externalMessageId,
            direction: "INBOUND",
            messageType: message.messageType,
            bodyEncrypted: message.body === undefined ? undefined : encryptPrivateValue(message.body),
            status: "RECEIVED",
            occurredAt: message.occurredAt,
          },
        });
        await tx.auditLog.create({
          data: {
            action: "WHATSAPP.MESSAGE_RECEIVED",
            entityType: "WhatsAppMessage",
            entityId: stored.id,
            summary: "Verified inbound WhatsApp message stored",
            metadata: { messageType: message.messageType, hasMediaReference: Boolean(message.mediaId) },
          },
        });
      }

      for (const status of parsed.statuses) {
        const stored = await tx.whatsAppMessage.findUnique({
          where: { externalMessageId: status.externalMessageId },
          select: { id: true, direction: true, status: true },
        });
        if (!stored || stored.direction !== "OUTBOUND") continue;
        const rank = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 } as const;
        const currentRank = stored.status in rank ? rank[stored.status as keyof typeof rank] : undefined;
        const nextRank = status.status in rank ? rank[status.status as keyof typeof rank] : undefined;
        if (stored.status === "FAILED" && status.status !== "FAILED") continue;
        if (currentRank !== undefined && nextRank !== undefined && currentRank >= nextRank) continue;

        await tx.whatsAppMessage.update({ where: { id: stored.id }, data: statusMutation(status) });
        await tx.auditLog.create({
          data: {
            action: "WHATSAPP.MESSAGE_STATUS_UPDATED",
            entityType: "WhatsAppMessage",
            entityId: stored.id,
            summary: "WhatsApp delivery status updated",
            metadata: { status: status.status, failureCode: status.failureCode },
          },
        });
      }

      await tx.webhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), failedAt: null, failureReason: null },
      });
      await tx.auditLog.create({
        data: {
          action: "WHATSAPP.WEBHOOK_PROCESSED",
          entityType: "WebhookEvent",
          entityId: event.id,
          summary: "Verified WhatsApp webhook processed",
          metadata: { messageCount: parsed.messages.length, statusCount: parsed.statuses.length },
        },
      });
      return { duplicate: false };
    });
    return NextResponse.json({ received: true, duplicate: result.duplicate });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
      const existing = await trustedPrisma.webhookEvent.findUnique({
        where: { provider_externalEventId: { provider: PROVIDER, externalEventId } },
        select: { processedAt: true },
      });
      if (existing?.processedAt) return NextResponse.json({ received: true, duplicate: true });
    }
    console.error("Verified WhatsApp webhook processing failed", cause);
    await recordProcessingFailure(externalEventId, parsed.summary).catch((failure) => {
      console.error("Could not record WhatsApp webhook failure", failure);
    });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
