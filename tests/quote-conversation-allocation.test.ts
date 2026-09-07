import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ensureQuoteConversation } from "../lib/quotes/conversations";

function fixture(occupied: string[] = []) {
  let saved: { anonymousLabel: string; quotationId: string; supplierCompanyId: string; quoteRequestId: string } | null = null;
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "request" }]),
    supplierQuotation: { findUnique: vi.fn().mockResolvedValue({ id: "quote", quoteRequestId: "request", supplierCompanyId: "company-b" }) },
    quoteConversation: {
      findUnique: vi.fn(async () => saved),
      findUniqueOrThrow: vi.fn(async () => saved),
      createMany: vi.fn(async ({ data: [candidate] }) => {
        if (occupied.includes(candidate.anonymousLabel)) return { count: 0 };
        saved = candidate;
        occupied.push(candidate.anonymousLabel);
        return { count: 1 };
      }),
    },
  };
  return { tx, client: tx as unknown as Prisma.TransactionClient };
}

describe("anonymous quote allocation under supplier RLS", () => {
  it("skips labels occupied by hidden competing suppliers", async () => {
    const { tx, client } = fixture(["A", "B"]);
    await expect(ensureQuoteConversation(client, "quote")).resolves.toMatchObject({ anonymousLabel: "C", supplierCompanyId: "company-b" });
    expect(tx.quoteConversation.createMany.mock.calls.map(([args]) => args.data[0].anonymousLabel)).toEqual(["A", "B", "C"]);
    expect(tx.quoteConversation.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it("preserves an existing label on retry or quotation revision", async () => {
    const { tx, client } = fixture(["A"]);
    const first = await ensureQuoteConversation(client, "quote");
    tx.quoteConversation.createMany.mockClear();
    expect(await ensureQuoteConversation(client, "quote")).toEqual(first);
    expect(tx.quoteConversation.createMany).not.toHaveBeenCalled();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.quoteConversation.findUnique.mock.invocationCallOrder[0]);
  });

  it("fails closed when all five labels are allocated", async () => {
    const { client } = fixture(["A", "B", "C", "D", "E"]);
    await expect(ensureQuoteConversation(client, "quote")).rejects.toThrow("QUOTE_CONVERSATION_LIMIT_REACHED");
  });

  it("cannot allocate for a quotation hidden by tenant policies", async () => {
    const { tx, client } = fixture();
    tx.supplierQuotation.findUnique.mockResolvedValueOnce(null as never);
    await expect(ensureQuoteConversation(client, "other-tenant-quote")).rejects.toThrow("QUOTATION_NOT_FOUND");
    expect(tx.quoteConversation.createMany).not.toHaveBeenCalled();
  });
});
