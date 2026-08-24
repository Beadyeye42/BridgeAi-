import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getBuyerSession } from "@/lib/buyer/session";
import { runAsDatabaseWorker } from "@/lib/db";
import { processSupplierEmailsSafely } from "@/lib/notifications/email-worker";
import { createBuyerQuestion } from "@/lib/quotes/conversations";
import { moderatePreSelectionQuoteMessage } from "@/lib/quotes/message-moderation";

const schema = z.object({
  reference: z.string().trim().regex(/^BA-[A-Z0-9-]{6,32}$/),
  conversationId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  body: z.string().trim().min(2).max(2000),
});

export async function POST(request: Request) {
  const session = await getBuyerSession();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid question." }, { status: 400 });
  const moderation = moderatePreSelectionQuoteMessage(parsed.data.body);
  if (!moderation.allowed) return NextResponse.json({ error: "Phone numbers, email addresses, street addresses, links and social handles stay protected until you select a quote." }, { status: 422 });

  const result = await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    const conversation = await tx.quoteConversation.findFirst({
      where: {
        id: parsed.data.conversationId,
        quoteRequest: { reference: parsed.data.reference, customerContactId: session.buyer.id, status: { in: ["OPEN", "MATCHING", "QUOTED"] } },
        quotation: { status: "SUBMITTED" }, status: "OPEN",
      },
      include: { quoteRequest: { select: { id: true, reference: true } } },
    });
    if (!conversation) return null;
    const { message, created } = await createBuyerQuestion(tx, {
      conversationId: conversation.id,
      body: parsed.data.body,
      idempotencyKey: `buyer-hub-question:${session.user.id}:${randomUUID()}`,
    });
    if (created) {
      const members = await tx.supplierTeamMembership.findMany({ where: { supplierCompanyId: conversation.supplierCompanyId, status: "ACTIVE" }, select: { userId: true } });
      const preferences = members.length ? await tx.notificationPreference.findMany({ where: { supplierCompanyId: conversation.supplierCompanyId, userId: { in: members.map(({ userId }) => userId) } }, select: { userId: true, inAppEnabled: true, emailQuotationUpdates: true } }) : [];
      const byUser = new Map(preferences.map((value) => [value.userId, value]));
      const notifications = members.flatMap(({ userId }) => {
        const preference = byUser.get(userId); const rows = [];
        if (preference?.inAppEnabled !== false) rows.push({ userId, supplierCompanyId: conversation.supplierCompanyId, type: "BUYER_QUESTION" as const, channel: "IN_APP" as const, title: `A buyer asked Quote ${conversation.anonymousLabel} a question`, body: "Reply privately in Bridge-iT. Contact details remain protected before selection.", actionUrl: `/dashboard/requests/${conversation.quoteRequest.reference}` });
        if (preference?.emailQuotationUpdates !== false) rows.push({ userId, supplierCompanyId: conversation.supplierCompanyId, type: "BUYER_QUESTION" as const, channel: "EMAIL" as const, title: `Buyer question for ${conversation.quoteRequest.reference}`, body: `A buyer asked a private question about Quote ${conversation.anonymousLabel}. Sign in to reply securely.`, actionUrl: `/dashboard/requests/${conversation.quoteRequest.reference}` });
        return rows;
      });
      if (notifications.length) await tx.notification.createMany({ data: notifications });
      await tx.buyerSecurityEvent.create({ data: { customerContactId: session.buyer.id, authUserId: session.user.id, eventType: "BUYER_PORTAL_QUESTION_SENT", metadata: { quoteRequestId: conversation.quoteRequest.id, anonymousLabel: conversation.anonymousLabel, quoteMessageId: message.id } } });
    }
    return { id: message.id };
  });
  if (!result) return NextResponse.json({ error: "That quote conversation is no longer open." }, { status: 409 });
  after(() => processSupplierEmailsSafely({ limit: 10 }));
  return NextResponse.json({ ok: true, messageId: result.id }, { status: 201 });
}
