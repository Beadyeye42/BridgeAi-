import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentSession, getPrimarySupplierCompanyId } from "@/lib/auth/session";
import { quoteMessageReplySchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { prisma, runAsDatabaseWorker } from "@/lib/db";
import { queueBuyerAnswer } from "@/lib/quotes/conversations";
import { moderatePreSelectionQuoteMessage } from "@/lib/quotes/message-moderation";
import { encryptPrivateValue } from "@/lib/security/encryption";
import { processWhatsAppJobs } from "@/lib/whatsapp/processor";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session || session.user.role !== "SUPPLIER") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const companyId = getPrimarySupplierCompanyId(session);
  if (!companyId) return NextResponse.json({ error: "No supplier company membership" }, { status: 403 });
  const parsed = quoteMessageReplySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });

  const moderation = moderatePreSelectionQuoteMessage(parsed.data.body);
  if (!moderation.allowed) {
    await prisma.$transaction(async (tx) => {
      const conversation = await tx.quoteConversation.findFirst({
        where: { id: parsed.data.conversationId, supplierCompanyId: companyId },
        select: { id: true },
      });
      if (!conversation) return;
      await tx.quoteMessageModerationEvent.create({
        data: { quoteConversationId: conversation.id, actorUserId: session.userId, outcome: "BLOCKED", reasons: moderation.reasons },
      });
      await writeAuditLog({
        actorUserId: session.userId,
        supplierCompanyId: companyId,
        action: "QUOTE_MESSAGE.BLOCKED",
        entityType: "QuoteConversation",
        entityId: conversation.id,
        summary: "A pre-selection supplier reply containing contact details was blocked",
        metadata: { reasons: moderation.reasons },
        request,
      }, tx);
    });
    return NextResponse.json({ error: "Contact details, addresses, links and social handles stay protected until the buyer selects a quote. Remove them and try again." }, { status: 422 });
  }

  let saved: { id: string; quoteRequestId: string; whatsappConversationId: string };
  try {
    saved = await prisma.$transaction(async (tx) => {
      const conversation = await tx.quoteConversation.findFirst({
        where: {
          id: parsed.data.conversationId,
          supplierCompanyId: companyId,
          status: "OPEN",
          quotation: { status: "SUBMITTED" },
          quoteRequest: { status: { in: ["OPEN", "MATCHING", "QUOTED"] } },
        },
        include: { quoteRequest: { select: { id: true, conversationId: true } } },
      });
      if (!conversation?.quoteRequest.conversationId) throw new Error("CONVERSATION_CLOSED");
      const question = await tx.quoteMessage.findFirst({
        where: {
          id: parsed.data.replyToId,
          quoteConversationId: conversation.id,
          sender: "BUYER",
          status: "DELIVERED",
          OR: [{ questionDueAt: null }, { questionDueAt: { gt: new Date() } }],
        },
      });
      if (!question) throw new Error("QUESTION_CLOSED");
      const message = await tx.quoteMessage.create({
        data: {
          quoteConversationId: conversation.id,
          sender: "SUPPLIER",
          senderUserId: session.userId,
          contentEncrypted: encryptPrivateValue(parsed.data.body),
          status: "PENDING",
          replyToId: question.id,
          idempotencyKey: `supplier-answer:${question.id}:${randomUUID()}`,
        },
      });
      await tx.quoteConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
      await writeAuditLog({
        actorUserId: session.userId,
        supplierCompanyId: companyId,
        action: "QUOTE_MESSAGE.SUPPLIER_REPLIED",
        entityType: "QuoteMessage",
        entityId: message.id,
        summary: "Supplier answered a private pre-selection buyer question",
        metadata: { quoteConversationId: conversation.id, replyToId: question.id },
        request,
      }, tx);
      return { id: message.id, quoteRequestId: conversation.quoteRequest.id, whatsappConversationId: conversation.quoteRequest.conversationId };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "This question has already been answered." }, { status: 409 });
    }
    const code = error instanceof Error ? error.message : "";
    if (["CONVERSATION_CLOSED", "QUESTION_CLOSED"].includes(code)) {
      return NextResponse.json({ error: "This question is no longer open for replies." }, { status: 409 });
    }
    throw error;
  }

  await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.quoteMessage.update({ where: { id: parsed.data.replyToId }, data: { answeredAt: new Date() } });
    await queueBuyerAnswer(tx, { quoteMessageId: saved.id, quoteRequestId: saved.quoteRequestId, whatsappConversationId: saved.whatsappConversationId });
  });
  after(() => processWhatsAppJobs({ limit: 5 }));
  return NextResponse.json({ ok: true, messageId: saved.id }, { status: 201 });
}
