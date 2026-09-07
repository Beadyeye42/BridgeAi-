import { describe, expect, it, vi } from "vitest";

const worker = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ runAsDatabaseWorker: worker }));
import { enqueueQuoteSummary } from "../lib/whatsapp/processor";

describe("quotation revision notifications", () => {
  it("queues each version once while preserving the original first-version key", async () => {
    let version = 1;
    const keys = new Set<string>();
    const tx = {
      supplierQuotation: { findUnique: vi.fn(async () => ({ id: "quote", quoteRequestId: "request", status: "SUBMITTED", currentVersionNumber: version, quoteRequest: { conversationId: "conversation" } })) },
      whatsAppJob: {
        createMany: vi.fn(async ({ data: [job] }) => {
          if (keys.has(job.idempotencyKey)) return { count: 0 };
          keys.add(job.idempotencyKey);
          return { count: 1 };
        }),
        findUnique: vi.fn(async ({ where }) => ({ id: where.idempotencyKey })),
      },
    };
    worker.mockImplementation((_identity, work) => work(tx));
    await expect(enqueueQuoteSummary("quote")).resolves.toEqual({ id: "quote-summary:request:quotation:quote" });
    await expect(enqueueQuoteSummary("quote")).resolves.toBeNull();
    version = 2;
    await expect(enqueueQuoteSummary("quote")).resolves.toEqual({ id: "quote-summary:request:quotation:quote:version:2" });
    await expect(enqueueQuoteSummary("quote")).resolves.toBeNull();
    expect(keys.size).toBe(2);
  });
});
