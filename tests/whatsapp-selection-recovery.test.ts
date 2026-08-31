import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConversationStage, Prisma } from "@prisma/client";
import { encryptPrivateValue } from "@/lib/security/encryption";
import { currentRequestConversationWhere, selectionRecovery, startsNewQuote } from "@/lib/whatsapp/selection-state";

const mocks = vi.hoisted(() => ({
  worker: vi.fn(), send: vi.fn().mockResolvedValue("wamid.test"), select: vi.fn().mockResolvedValue({ id: "grant" }),
}));
vi.mock("@/lib/db", () => ({ runAsDatabaseWorker: mocks.worker }));
vi.mock("@/lib/whatsapp/meta-client", () => ({ sendMetaText: mocks.send, sendMetaTemplate: mocks.send }));
vi.mock("@/lib/quotes/selection", () => ({ selectQuotationForCustomer: mocks.select }));
vi.mock("@/lib/notifications/email-worker", () => ({ processSupplierEmailsSafely: vi.fn() }));
vi.mock("@/lib/monitoring/operational-alerts", () => ({ runProductionMonitoringSafely: vi.fn() }));
import { processWhatsAppJobs } from "@/lib/whatsapp/processor";

function fixture(text: string, status = "SELECTED", stage: AiConversationStage = "AWAITING_SELECTION") {
  process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  const inbound = { id: "inbound", direction: "INBOUND", bodyEncrypted: encryptPrivateValue(text), occurredAt: new Date(), attachments: [] };
  const conversation = {
    id: "conversation", aiStage: stage, aiConsentAt: new Date("2026-08-01"), aiSessionStartedAt: new Date("2026-08-25"),
    aiLastQuestionKey: null, aiDraftEncrypted: null, customerContactId: "buyer",
    customerContact: { phoneEncrypted: encryptPrivateValue("447700900111"), preferredFirstNameEncrypted: encryptPrivateValue("Alex") },
    messages: [inbound],
  };
  const job = { id: "job", conversationId: conversation.id, type: "PROCESS_INBOUND", status: "PROCESSING", attempts: 1, createdAt: new Date() };
  const request = { id: "latest", reference: "BA-2026-LATEST", status, createdAt: new Date("2026-08-25"),
    category: { slug: "man-and-van", parent: null },
    quotations: status === "QUOTED" ? Array.from({ length: 5 }, (_, i) => ({ id: `quote_${i + 1}`, validUntil: new Date(Date.now() + 86_400_000), conversation: { anonymousLabel: String.fromCharCode(65 + i) } })) : [],
  };
  const tx = {
    $queryRaw: vi.fn().mockImplementation((query: TemplateStringsArray) => Promise.resolve(query.join("").includes("SELECT candidate.id") ? [{ id: "job" }] : [])),
    whatsAppJob: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn(),
      update: vi.fn().mockResolvedValue(job), findUnique: vi.fn().mockImplementation(() => Promise.resolve({ ...job, conversation, whatsappMessage: inbound })) },
    conversation: {
      update: vi.fn().mockImplementation(({ data }) => { Object.assign(conversation, data); return Promise.resolve(conversation); }),
      updateMany: vi.fn().mockImplementation(({ data }) => { Object.assign(conversation, data); return Promise.resolve({ count: 1 }); }),
    },
    whatsAppMessage: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "outbound" }), update: vi.fn(), updateMany: vi.fn() },
    quoteRequest: { findFirst: vi.fn().mockResolvedValue(request) },
    contactAccessGrant: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  mocks.worker.mockImplementation((_worker, work: (value: Prisma.TransactionClient) => unknown) => work(tx as unknown as Prisma.TransactionClient));
  return { tx, conversation, request };
}

async function processOne() {
  expect(await processWhatsAppJobs({ limit: 1, concurrency: 1, flushSupplierEmails: false })).toBe(1);
}

beforeEach(() => vi.clearAllMocks());

describe("real WhatsApp processor quote-state recovery", () => {
  it("starts NEW QUOTE while a previous quote is awaiting selection", async () => {
    const { tx, conversation } = fixture("NEW QUOTE", "QUOTED");
    await processOne();
    expect(conversation.aiStage).toBe("COLLECTING");
    expect(tx.quoteRequest.findFirst).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledWith("447700900111", expect.stringContaining("Bridge another request"));
    expect(mocks.select).not.toHaveBeenCalled();
    expect(tx.$queryRaw.mock.calls.flat()).toContain("WHATSAPP.NEW_QUOTE_STARTED");
  });

  it.each([1, 2, 3, 4, 5])("keeps numbered reply %i as selection, not a main-menu command", async (number) => {
    fixture(String(number), "QUOTED");
    await processOne();
    expect(mocks.select).toHaveBeenCalledWith(expect.objectContaining({ quotationId: `quote_${number}` }));
  });

  it("reconciles a Hub-selected request without falling back to older open requests", async () => {
    const { tx, conversation } = fixture("can I get another price please");
    await processOne();
    expect(tx.quoteRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: "conversation" } }));
    expect(conversation.aiStage).toBe("SELECTION_RECORDED");
    expect(mocks.send).toHaveBeenCalledWith("447700900111", expect.stringContaining("already selected a supplier for BA-2026-LATEST"));
    expect(mocks.send).toHaveBeenCalledWith("447700900111", expect.stringContaining("NEW QUOTE"));
    expect(tx.$queryRaw.mock.calls.flat()).toContain("WHATSAPP.SELECTION_STATE_RECONCILED");
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("does not tell a buyer an unquoted request is an unavailable quote", async () => {
    const { conversation } = fixture("yes", "OPEN");
    await processOne();
    expect(conversation.aiStage).toBe("QUOTE_CREATED");
    expect(mocks.send).toHaveBeenCalledWith("447700900111", expect.stringContaining("no supplier quotes to choose from yet"));
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("recovers safely when all quotes have expired", async () => {
    const { request, conversation } = fixture("SELECT A", "QUOTED");
    request.quotations.forEach((quote) => { quote.validUntil = new Date(0); });
    await processOne();
    expect(conversation.aiStage).toBe("QUOTE_CREATED");
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledWith("447700900111", expect.stringContaining("expired"));
  });
});

describe("selection state guards", () => {
  it("allows explicit new jobs from all existing post-quote states", () => {
    for (const stage of ["QUOTE_CREATED", "AWAITING_SELECTION", "SELECTION_RECORDED", "CLOSED"] as const) {
      expect(startsNewQuote("new quote", stage)).toBe(true);
      expect(startsNewQuote("another quote for a sofa removal", stage)).toBe(true);
    }
    expect(startsNewQuote("1", "AWAITING_SELECTION")).toBe(false);
    expect(startsNewQuote("1", "COLLECTING")).toBe(true);
  });
  it("protects an active draft and newer requests from late selection/summary events", () => {
    const createdAt = new Date("2026-08-25");
    const where = currentRequestConversationWhere({ id: "old", conversationId: "c", createdAt });
    expect(where.aiStage).toEqual({ in: ["QUOTE_CREATED", "AWAITING_SELECTION"] });
    expect(where.aiSessionStartedAt).toEqual({ lte: createdAt });
    expect(where.quoteRequests).toEqual({ none: { OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: "old" } }] } });
  });
  it("handles no current request without inventing a quote", () => {
    expect(selectionRecovery(null)).toMatchObject({ stage: "COLLECTING", reply: expect.stringContaining("no quote waiting") });
  });
});
