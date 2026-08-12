import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { encryptPrivateValue } from "@/lib/security/encryption";
import { addSupplierResponseHours } from "@/lib/quotes/response-clock";

type Tx = Prisma.TransactionClient;

export async function ensureQuoteConversation(tx: Tx, quotationId: string) {
  const existing = await tx.quoteConversation.findUnique({ where: { quotationId } });
  if (existing) return existing;
  const quotation = await tx.supplierQuotation.findUnique({ where: { id: quotationId } });
  if (!quotation) throw new Error("QUOTATION_NOT_FOUND");
  await tx.$queryRaw`SELECT id FROM bridge_ai."QuoteRequest" WHERE id = ${quotation.quoteRequestId} FOR UPDATE`;
  const labels = await tx.quoteConversation.findMany({ where: { quoteRequestId: quotation.quoteRequestId }, select: { anonymousLabel: true } });
  const anonymousLabel = ["A", "B", "C", "D", "E"].find((label) => !labels.some((row) => row.anonymousLabel === label));
  if (!anonymousLabel) throw new Error("QUOTE_CONVERSATION_LIMIT_REACHED");
  return tx.quoteConversation.create({ data: { quoteRequestId: quotation.quoteRequestId, quotationId, supplierCompanyId: quotation.supplierCompanyId, anonymousLabel } });
}

export async function createBuyerQuestion(tx: Tx, input: {
  conversationId: string;
  body: string;
  idempotencyKey: string;
  broadcastKey?: string;
}) {
  const dueAt = addSupplierResponseHours(new Date(), 4);
  const message = await tx.quoteMessage.create({
    data: {
      quoteConversationId: input.conversationId,
      sender: "BUYER",
      contentEncrypted: encryptPrivateValue(input.body),
      status: "DELIVERED",
      deliveredAt: new Date(),
      questionDueAt: dueAt,
      idempotencyKey: input.idempotencyKey,
      broadcastKey: input.broadcastKey,
    },
  });
  await tx.quoteConversation.update({ where: { id: input.conversationId }, data: { lastMessageAt: new Date(), questionResponseDueAt: dueAt } });
  return message;
}

export async function queueBuyerAnswer(tx: Tx, input: { quoteMessageId: string; quoteRequestId: string; whatsappConversationId: string }) {
  return tx.whatsAppJob.upsert({
    where: { idempotencyKey: `quote-message:${input.quoteMessageId}` },
    create: {
      type: "SEND_QUOTE_MESSAGE",
      idempotencyKey: `quote-message:${input.quoteMessageId}`,
      conversationId: input.whatsappConversationId,
      quoteRequestId: input.quoteRequestId,
      quoteMessageId: input.quoteMessageId,
    },
    update: {},
  });
}

export function newBroadcastKey() { return randomUUID(); }
