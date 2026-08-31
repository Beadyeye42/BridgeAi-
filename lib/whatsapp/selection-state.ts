import type { AiConversationStage, Prisma } from "@prisma/client";
import { isNewQuoteRequest } from "@/lib/whatsapp/policy";

export function startsNewQuote(text: string, stage: AiConversationStage) {
  // The numbered selection menu owns “1” while quotes are on screen. Explicit
  // NEW QUOTE commands must remain available in every conversation stage.
  return isNewQuoteRequest(text) && !(stage === "AWAITING_SELECTION" && text.trim() === "1");
}

export function currentRequestConversationWhere(request: {
  id: string; conversationId: string; createdAt: Date;
}): Prisma.ConversationWhereInput {
  return {
    id: request.conversationId,
    aiStage: { in: ["QUOTE_CREATED", "AWAITING_SELECTION"] },
    aiSessionStartedAt: { lte: request.createdAt },
    quoteRequests: { none: {
      OR: [
        { createdAt: { gt: request.createdAt } },
        { createdAt: request.createdAt, id: { gt: request.id } },
      ],
    } },
  };
}

export function selectionRecovery(request: {
  reference: string; status: string; quotations: { validUntil: Date | null }[];
} | null, now = new Date()): { stage: AiConversationStage; reply: string } | null {
  const next = "Reply BUYER HUB to view your requests, or NEW QUOTE to start another job. No existing request will be changed.";
  if (!request) return { stage: "COLLECTING", reply: `There is no quote waiting for selection in this conversation. ${next}` };
  if (["SELECTED", "ACCEPTED", "CONFIRMED", "COMPLETED"].includes(request.status)) {
    return { stage: "SELECTION_RECORDED", reply: `You have already selected a supplier for ${request.reference}. ${next}` };
  }
  if (!["OPEN", "MATCHING", "QUOTED"].includes(request.status)) {
    return { stage: "QUOTE_CREATED", reply: `Request ${request.reference} is no longer open for quote selection. ${next}` };
  }
  if (!request.quotations.length) {
    return { stage: "QUOTE_CREATED", reply: `Request ${request.reference} has no supplier quotes to choose from yet. I’ll send you an update when a quote arrives. ${next}` };
  }
  if (!request.quotations.some((quote) => !quote.validUntil || quote.validUntil > now)) {
    return { stage: "QUOTE_CREATED", reply: `The supplier quotes for ${request.reference} have expired, so I haven’t selected one. ${next}` };
  }
  return null;
}
