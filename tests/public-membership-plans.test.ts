import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), findMany: vi.fn(), verifiedUser: vi.fn() }));
vi.mock("@/lib/supabase/verified-user", () => ({ getVerifiedAuthUser: mocks.verifiedUser }));
vi.mock("@prisma/client", () => ({
  Prisma: {},
  PrismaClient: class {
    $extends() { return {}; }
    $transaction(work: (tx: unknown) => Promise<unknown>) {
      return work({ $executeRaw: mocks.execute, membershipPlan: { findMany: mocks.findMany } });
    }
  },
}));
import { getPublicMembershipPlans } from "@/lib/db";

describe("public membership pricing boundary", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.execute.mockResolvedValue(0); mocks.findMany.mockResolvedValue([]); });

  it("limits anonymous pricing reads to active plans and explicit public fields", async () => {
    await getPublicMembershipPlans();
    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ active: true });
    expect(Object.keys(query.select).sort()).toEqual([
      "currency", "description", "id", "maximumActiveOpportunities", "maximumRadiusMiles",
      "monthlyPricePence", "name", "nationwideAllowed", "taxEnabled", "tier",
    ].sort());
    expect(mocks.verifiedUser).not.toHaveBeenCalled();
  });

  it("establishes a read-only transaction before querying and never sets an identity or worker role", async () => {
    await getPublicMembershipPlans();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0].join("")).toBe("SET TRANSACTION READ ONLY");
    expect(mocks.execute.mock.invocationCallOrder[0]).toBeLessThan(mocks.findMany.mock.invocationCallOrder[0]);
  });

  it("does not query if the read-only boundary cannot be established", async () => {
    mocks.execute.mockRejectedValue(new Error("Read-only transaction unavailable"));
    await expect(getPublicMembershipPlans()).rejects.toThrow("Read-only transaction unavailable");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
