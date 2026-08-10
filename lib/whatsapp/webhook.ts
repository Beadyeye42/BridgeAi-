import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const MAX_META_WEBHOOK_BYTES = 1_000_000;
export const MAX_META_WEBHOOK_OPERATIONS = 1_000;

const messageSchema = z.object({
  from: z.string().regex(/^\d{5,32}$/),
  id: z.string().min(1).max(512),
  timestamp: z.string().regex(/^\d{1,16}$/),
  type: z.string().min(1).max(64),
  text: z.object({ body: z.string().max(20_000) }).optional(),
  image: z.object({ id: z.string().max(512), caption: z.string().max(20_000).optional(), mime_type: z.string().max(255).optional() }).passthrough().optional(),
  document: z.object({ id: z.string().max(512), caption: z.string().max(20_000).optional(), mime_type: z.string().max(255).optional(), filename: z.string().max(255).optional() }).passthrough().optional(),
  audio: z.object({ id: z.string().max(512), mime_type: z.string().max(255).optional() }).passthrough().optional(),
  location: z.object({
    latitude: z.number().finite(),
    longitude: z.number().finite(),
    name: z.string().max(1_000).optional(),
    address: z.string().max(2_000).optional(),
  }).optional(),
  interactive: z.object({
    type: z.string().max(64).optional(),
    button_reply: z.object({ id: z.string().max(512), title: z.string().max(2_000) }).optional(),
    list_reply: z.object({ id: z.string().max(512), title: z.string().max(2_000), description: z.string().max(4_000).optional() }).optional(),
  }).passthrough().optional(),
}).passthrough();

const statusSchema = z.object({
  id: z.string().min(1).max(512),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  timestamp: z.string().regex(/^\d{1,16}$/),
  errors: z.array(z.object({ code: z.union([z.string(), z.number()]) }).passthrough()).max(20).optional(),
}).passthrough();

const contactSchema = z.object({
  wa_id: z.string().regex(/^\d{5,32}$/),
  profile: z.object({ name: z.string().max(1_000) }).optional(),
}).passthrough();

const payloadSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({
    id: z.string().min(1).max(512),
    changes: z.array(z.object({
      field: z.string().max(128),
      value: z.object({
        messaging_product: z.literal("whatsapp").optional(),
        contacts: z.array(contactSchema).max(MAX_META_WEBHOOK_OPERATIONS).optional(),
        messages: z.array(messageSchema).max(MAX_META_WEBHOOK_OPERATIONS).optional(),
        statuses: z.array(statusSchema).max(MAX_META_WEBHOOK_OPERATIONS).optional(),
      }).passthrough(),
    }).passthrough()).max(MAX_META_WEBHOOK_OPERATIONS),
  }).passthrough()).max(MAX_META_WEBHOOK_OPERATIONS),
});

export type InboundMessage = {
  externalMessageId: string;
  from: string;
  displayName?: string;
  occurredAt: Date;
  messageType: "TEXT" | "IMAGE" | "DOCUMENT" | "AUDIO" | "LOCATION" | "INTERACTIVE" | "SYSTEM";
  body?: string;
  mediaId?: string;
  mediaMimeType?: string;
  mediaFileName?: string;
};

export type MessageStatusUpdate = {
  externalMessageId: string;
  occurredAt: Date;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  failureCode?: string;
};

export type ParsedMetaWebhook = {
  messages: InboundMessage[];
  statuses: MessageStatusUpdate[];
  summary: {
    object: "whatsapp_business_account";
    entryIds: string[];
    messageIds: string[];
    statusIds: string[];
    mediaIds: string[];
    messageCount: number;
    statusCount: number;
  };
};

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyMetaToken(received: string | null, expected: string) {
  return received !== null && safeEqual(received, expected);
}

export function verifyMetaSignature(rawBody: Uint8Array, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const received = header.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(received.toLowerCase(), expected);
}

export function metaEventDigest(rawBody: Uint8Array) {
  return createHash("sha256").update(rawBody).digest("hex");
}

function occurredAt(timestamp: string) {
  const date = new Date(Number(timestamp) * 1_000);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid WhatsApp timestamp");
  return date;
}

function messageContent(message: z.infer<typeof messageSchema>) {
  if (message.type === "text" && message.text) return { messageType: "TEXT" as const, body: message.text.body };
  if (message.type === "image" && message.image) return { messageType: "IMAGE" as const, body: message.image.caption, mediaId: message.image.id, mediaMimeType: message.image.mime_type };
  if (message.type === "document" && message.document) return { messageType: "DOCUMENT" as const, body: message.document.caption, mediaId: message.document.id, mediaMimeType: message.document.mime_type, mediaFileName: message.document.filename };
  if (message.type === "audio" && message.audio) return { messageType: "AUDIO" as const, mediaId: message.audio.id, mediaMimeType: message.audio.mime_type };
  if (message.type === "location" && message.location) return { messageType: "LOCATION" as const, body: JSON.stringify(message.location) };
  if (message.type === "interactive" && message.interactive) {
    const reply = message.interactive.button_reply ?? message.interactive.list_reply;
    return { messageType: "INTERACTIVE" as const, body: reply?.title ?? reply?.id };
  }
  return { messageType: "SYSTEM" as const };
}

export function parseMetaWebhook(value: unknown): ParsedMetaWebhook {
  const payload = payloadSchema.parse(value);
  const messages: InboundMessage[] = [];
  const statuses: MessageStatusUpdate[] = [];
  const entryIds = new Set<string>();
  const mediaIds = new Set<string>();

  for (const entry of payload.entry) {
    entryIds.add(entry.id);
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const names = new Map(change.value.contacts?.map((contact) => [contact.wa_id, contact.profile?.name]));
      for (const message of change.value.messages ?? []) {
        const content = messageContent(message);
        if (content.mediaId) mediaIds.add(content.mediaId);
        messages.push({
          externalMessageId: message.id,
          from: message.from,
          displayName: names.get(message.from),
          occurredAt: occurredAt(message.timestamp),
          ...content,
        });
      }
      for (const status of change.value.statuses ?? []) {
        statuses.push({
          externalMessageId: status.id,
          occurredAt: occurredAt(status.timestamp),
          status: status.status.toUpperCase() as MessageStatusUpdate["status"],
          failureCode: status.status === "failed" && status.errors?.[0] ? String(status.errors[0].code) : undefined,
        });
      }
    }
  }

  if (messages.length + statuses.length > MAX_META_WEBHOOK_OPERATIONS) {
    throw new Error("WhatsApp webhook operation limit exceeded");
  }

  return {
    messages,
    statuses,
    summary: {
      object: payload.object,
      entryIds: [...entryIds],
      messageIds: messages.map((message) => message.externalMessageId),
      statusIds: statuses.map((status) => status.externalMessageId),
      mediaIds: [...mediaIds],
      messageCount: messages.length,
      statusCount: statuses.length,
    },
  };
}
