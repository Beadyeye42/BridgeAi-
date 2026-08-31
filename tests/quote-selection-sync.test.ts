import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
const worker = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ runAsDatabaseWorker: worker, prisma: {}, runWithDatabaseIdentity: vi.fn() }));
import { selectQuotationForCustomer } from "@/lib/quotes/selection";

function fixture() {
  const quoteRequest = { id: "request", conversationId: "conversation", customerContactId: "buyer", createdAt: new Date("2026-08-25"),
    status: "QUOTED", reference: "BA-2026-TEST", category: { buyerExperienceConfig: null, parent: null } };
  const quotation = { id: "quote", quoteRequestId: "request", quoteRequest, status: "SUBMITTED", validUntil: new Date(Date.now() + 60_000), supplierCompanyId: "supplier", assignmentId: "assignment" };
  const tx = {
    $queryRaw: vi.fn(), $executeRaw: vi.fn(),
    supplierQuotation: { findUnique: vi.fn().mockResolvedValue(quotation), update: vi.fn(), updateMany: vi.fn() },
    contactAccessGrant: { create: vi.fn().mockResolvedValue({ id: "grant" }) },
    supplierAssignment: { updateMany: vi.fn() }, quoteRequest: { update: vi.fn() },
    conversation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    quoteConversation: { updateMany: vi.fn() }, quoteSelectionEvent: { create: vi.fn() },
    buyerOrder: { create: vi.fn().mockResolvedValue({ id: "order" }) }, whatsAppJob: { upsert: vi.fn() },
    supplierTeamMembership: { findMany: vi.fn().mockResolvedValue([]) }, buyerSecurityEvent: { create: vi.fn() },
  };
  worker.mockImplementation((_scope, work: (tx: Prisma.TransactionClient) => unknown) => work(tx as unknown as Prisma.TransactionClient));
  return { tx, quotation };
}
beforeEach(() => vi.clearAllMocks());

describe("shared quote selection transaction", () => {
  it.each(["BUYER_PORTAL", "WHATSAPP"] as const)("synchronises WhatsApp after %s selection and records evidence", async (source) => {
    const { tx } = fixture();
    await selectQuotationForCustomer({ quotationId: "quote", source, buyerAuthUserId: "auth-buyer", buyerCustomerContactId: "buyer", evidence: "test selection" });
    expect(tx.conversation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "conversation", aiStage: { in: ["QUOTE_CREATED", "AWAITING_SELECTION"] }, aiSessionStartedAt: { lte: new Date("2026-08-25") }, quoteRequests: expect.any(Object) }),
      data: { aiStage: "SELECTION_RECORDED" },
    });
    expect(tx.quoteRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SELECTED" }) }));
    expect(tx.quoteSelectionEvent.create).toHaveBeenCalled();
    if (source === "BUYER_PORTAL") expect(tx.buyerSecurityEvent.create).toHaveBeenCalled();
    else expect(tx.$queryRaw.mock.calls.flat()).toContain("WHATSAPP.CUSTOMER_SELECTION_RECORDED");
  });
  it("rejects another buyer before mutating quotes or conversation state", async () => {
    const { tx } = fixture();
    await expect(selectQuotationForCustomer({ quotationId: "quote", source: "BUYER_PORTAL", buyerAuthUserId: "other", buyerCustomerContactId: "other", evidence: "forbidden" })).rejects.toThrow("BUYER_SELECTION_SCOPE_MISMATCH");
    expect(tx.conversation.updateMany).not.toHaveBeenCalled();
    expect(tx.contactAccessGrant.create).not.toHaveBeenCalled();
  });
  it("does not override a newer draft when the conditional state update affects no rows", async () => {
    const { tx } = fixture();
    tx.conversation.updateMany.mockResolvedValue({ count: 0 });
    await selectQuotationForCustomer({ quotationId: "quote", evidence: "test" });
    expect(tx.conversation.updateMany).toHaveBeenCalledOnce();
    expect(tx.buyerOrder.create).toHaveBeenCalledOnce();
  });
});
