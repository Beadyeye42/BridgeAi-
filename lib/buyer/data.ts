import "server-only";

import { Prisma } from "@prisma/client";
import { cache } from "react";
import { runAsDatabaseWorker } from "@/lib/db";
import { decryptPrivateValue } from "@/lib/security/encryption";
import { requireBuyerSession } from "@/lib/buyer/session";

function reveal(value: Uint8Array | null | undefined) {
  if (!value) return null;
  try { return decryptPrivateValue(value); } catch { return null; }
}

export const getBuyerProfile = cache(async function getBuyerProfile() {
  const { buyer } = await requireBuyerSession();
  return {
    id: buyer.id,
    firstName: reveal(buyer.preferredFirstNameEncrypted) ?? reveal(buyer.displayNameEncrypted)?.split(/\s+/)[0] ?? "there",
    displayName: reveal(buyer.displayNameEncrypted),
    companyName: reveal(buyer.companyNameEncrypted),
    postcode: reveal(buyer.defaultPostcodeEncrypted),
    buyerType: buyer.buyerTypePreference,
    whatsappUpdates: buyer.buyerWhatsAppUpdates,
    emailUpdates: buyer.buyerEmailUpdates,
  };
});

const buyerRequestInclude = {
  category: { select: { name: true, slug: true, buyerExperienceConfig: true, parent: { select: { buyerExperienceConfig: true } } } },
  items: { orderBy: { displayOrder: "asc" as const } },
  attachments: { where: { scanStatus: "CLEAN" as const }, select: { id: true, fileName: true, mimeType: true, byteSize: true } },
  quotations: {
    where: { status: { in: ["SUBMITTED", "ACCEPTED"] } },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    take: 5,
    select: {
      id: true, status: true, price: true, currency: true, leadTimeDays: true, validUntil: true,
      notes: true, specification: true, deliveryCost: true, collectionAvailable: true,
      availability: true, warranty: true, paymentTerms: true, assumptions: true,
      exclusions: true, vatIncluded: true, submittedAt: true,
      conversation: {
        select: {
          id: true, anonymousLabel: true, status: true,
          messages: { orderBy: { createdAt: "asc" }, select: { id: true, sender: true, contentEncrypted: true, createdAt: true, questionDueAt: true, answeredAt: true } },
        },
      },
    },
  },
  buyerOrder: { select: { reference: true, state: true, stageKey: true } },
} satisfies Prisma.QuoteRequestInclude;

const buyerOrderInclude = {
  events: { orderBy: { createdAt: "asc" } },
  quoteRequest: { include: { category: { select: { name: true, buyerExperienceConfig: true, parent: { select: { buyerExperienceConfig: true } } } }, items: { orderBy: { displayOrder: "asc" } } } },
  quotation: { select: { price: true, currency: true, leadTimeDays: true, validUntil: true, notes: true, specification: true, deliveryCost: true, vatIncluded: true } },
  supplierCompany: { select: { legalName: true, tradingName: true, contactEmail: true, contactPhone: true } },
} satisfies Prisma.BuyerOrderInclude;

export async function getBuyerRequests() {
  const { buyer } = await requireBuyerSession("/buyer/requests");
  return runAsDatabaseWorker("buyer_auth", (tx) => tx.quoteRequest.findMany({
    where: { customerContactId: buyer.id, status: { not: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    select: {
      reference: true, title: true, summary: true, status: true, deliveryPostcode: true, qualificationData: true,
      requiredBy: true, responseDueAt: true, publishedAt: true, createdAt: true,
      category: { select: { name: true, buyerExperienceConfig: true, parent: { select: { buyerExperienceConfig: true } } } },
      _count: { select: { quotations: { where: { status: { in: ["SUBMITTED", "ACCEPTED"] } } }, attachments: true } },
    },
  }));
}

export async function getBuyerRequest(reference: string) {
  const { buyer } = await requireBuyerSession(`/buyer/requests/${reference}`);
  const request = await runAsDatabaseWorker("buyer_auth", (tx) => tx.quoteRequest.findFirst({
    where: { reference, customerContactId: buyer.id, status: { not: "DRAFT" } },
    include: buyerRequestInclude,
  }));
  if (!request) return null;
  return {
    ...request,
    quotations: request.quotations.map((quote) => ({
      ...quote,
      label: quote.conversation?.anonymousLabel ?? "?",
      expired: Boolean(quote.validUntil && quote.validUntil <= new Date()),
      messages: quote.conversation?.messages.map((message) => ({ ...message, body: reveal(message.contentEncrypted) ?? "Message unavailable" })) ?? [],
    })),
  };
}

export async function getBuyerOrders() {
  const { buyer } = await requireBuyerSession("/buyer/orders");
  return runAsDatabaseWorker("buyer_auth", (tx) => tx.buyerOrder.findMany({
    where: { customerContactId: buyer.id },
    orderBy: { createdAt: "desc" },
    select: {
      reference: true, state: true, stageKey: true, nextAction: true, createdAt: true, updatedAt: true,
      quoteRequest: { select: { reference: true, title: true, deliveryPostcode: true, category: { select: { name: true, buyerExperienceConfig: true, parent: { select: { buyerExperienceConfig: true } } } } } },
      quotation: { select: { price: true, currency: true, leadTimeDays: true } },
      supplierCompany: { select: { legalName: true, tradingName: true } },
    },
  }));
}

export async function getBuyerOrder(reference: string) {
  const { buyer } = await requireBuyerSession(`/buyer/orders/${reference}`);
  return runAsDatabaseWorker("buyer_auth", (tx) => tx.buyerOrder.findFirst({
    where: { reference, customerContactId: buyer.id },
    include: buyerOrderInclude,
  }));
}

export async function getBuyerRewards() {
  const { buyer } = await requireBuyerSession("/buyer/rewards");
  return runAsDatabaseWorker("buyer_auth", async (tx) => {
    const account = await tx.buyerRewardAccount.findUnique({ where: { customerContactId: buyer.id } });
    const ledger = await tx.buyerRewardLedger.findMany({
      where: { customerContactId: buyer.id }, orderBy: { createdAt: "desc" }, take: 100,
      select: { id: true, entryType: true, points: true, description: true, createdAt: true, buyerOrder: { select: { reference: true } } },
    });
    return { account: account ?? { balance: 0, lifetimeEarned: 0, tier: "BRONZE" as const }, ledger };
  });
}
