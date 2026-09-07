import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { encryptPrivateValue } from "@/lib/security/encryption";
import { addSupplierResponseHours } from "@/lib/quotes/response-clock";

type Tx = Prisma.TransactionClient;

export async function ensureQuoteConversation(tx: Tx, quotationId: string) {
  const quotation = await tx.supplierQuotation.findUnique({ where: { id: quotationId } });
  if (!quotation) throw new Error("QUOTATION_NOT_FOUND");
  await tx.$queryRaw`SELECT id FROM bridge_ai."QuoteRequest" WHERE id = ${quotation.quoteRequestId} FOR UPDATE`;
  const existing = await tx.quoteConversation.findUnique({ where: { quotationId } });
  if (existing) return existing;
  // RLS hides competing suppliers' conversations. Let the database's unique
  // constraint arbitrate occupied labels without reading another tenant's rows
  // or aborting this transaction on an expected conflict.
  for (const anonymousLabel of ["A", "B", "C", "D", "E"]) {
    const inserted = await tx.quoteConversation.createMany({
      data: [{ quoteRequestId: quotation.quoteRequestId, quotationId, supplierCompanyId: quotation.supplierCompanyId, anonymousLabel }],
      skipDuplicates: true,
    });
    if (inserted.count) return tx.quoteConversation.findUniqueOrThrow({ where: { quotationId } });
  }
  throw new Error("QUOTE_CONVERSATION_LIMIT_REACHED");
}

export async function createBuyerQuestion(tx: Tx, input: {
  conversationId: string;
  body: string;
  idempotencyKey: string;
  broadcastKey?: string;
}) {
  const existing = await tx.quoteMessage.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return { message: existing, created: false } as const;
  }

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
  return { message, created: true } as const;
}

export async function queueBuyerAnswer(tx: Tx, input: { quoteMessageId: string; quoteRequestId: string; whatsappConversationId: string }) {
  return tx.whatsAppJob.createMany({
    data: [{
      type: "SEND_QUOTE_MESSAGE",
      idempotencyKey: `quote-message:${input.quoteMessageId}`,
      conversationId: input.whatsappConversationId,
      quoteRequestId: input.quoteRequestId,
      quoteMessageId: input.quoteMessageId,
    }],
    skipDuplicates: true,
  });
}

export function newBroadcastKey() { return randomUUID(); }
