import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { lockSupplierAssignmentScope } from "@/lib/matching/distribution";

describe("supplier assignment locking", () => {
  it("executes void advisory locks without asking Prisma to deserialize them", async () => {
    const executeRaw = vi.fn(async () => 0);
    const queryRaw = vi.fn();
    const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await lockSupplierAssignmentScope(tx, ["supplier-b", "supplier-a", "supplier-b"]);

    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
