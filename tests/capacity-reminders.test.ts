import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
const worker = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ runAsDatabaseWorker: worker }));
import { notifySuppliersWithStaleCapacity } from "@/lib/matching/stale-capacity";

beforeEach(() => vi.clearAllMocks());
describe("capacity reminder delivery", () => {
  it("creates and audits both reminder types then deduplicates unread notifications", async () => {
    const stored = new Map<string, { id: string }>();
    const company = { id: "company", memberships: [{ userId: "member" }], capabilities: [{ declaredMonthlyCapacity: 10 }] };
    const tx = {
      matchingConfiguration: { findUnique: vi.fn().mockResolvedValue(null) },
      supplierCompany: { findMany: vi.fn().mockResolvedValue([company]) },
      supplierAssignment: { groupBy: vi.fn().mockResolvedValue([{ supplierCompanyId: "company", _count: { _all: 9 } }]) },
      notification: {
        findFirst: vi.fn().mockImplementation(({ where }) => Promise.resolve(stored.get(where.actionUrl) ?? null)),
        create: vi.fn().mockImplementation(({ data }) => { const n = { id: data.actionUrl }; stored.set(data.actionUrl, n); return Promise.resolve(n); }),
      }, $queryRaw: vi.fn(),
    };
    worker.mockImplementation((_scope, work: (value: Prisma.TransactionClient) => unknown) => work(tx as unknown as Prisma.TransactionClient));
    expect(await notifySuppliersWithStaleCapacity()).toMatchObject({ notifications: 1, capacityNotifications: 1 });
    expect(tx.notification.create).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.calls.every((call) => call[0].join("").includes("WHATSAPP.CAPACITY_REMINDER_CREATED"))).toBe(true);
    expect(await notifySuppliersWithStaleCapacity()).toMatchObject({ notifications: 0, capacityNotifications: 0 });
    expect(tx.notification.create).toHaveBeenCalledTimes(2);
    expect(worker).toHaveBeenCalledWith("whatsapp_ai", expect.any(Function));
  });
});
