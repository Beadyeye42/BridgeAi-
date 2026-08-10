import "server-only";
import { runAsDatabaseWorker } from "@/lib/db";

export async function expireElapsedMemberships(now = new Date()) {
  return runAsDatabaseWorker("stripe_billing", async (tx) => {
    const elapsed = await tx.subscription.findMany({
      where: {
        status: "ACTIVE",
        currentPeriodEnd: { lte: now },
      },
      select: { id: true, supplierCompanyId: true, currentPeriodEnd: true },
      take: 500,
    });

    if (!elapsed.length) return { expired: 0 };

    const ids = elapsed.map((subscription) => subscription.id);
    const result = await tx.subscription.updateMany({
      where: { id: { in: ids }, status: "ACTIVE", currentPeriodEnd: { lte: now } },
      data: { status: "EXPIRED" },
    });

    await tx.auditLog.createMany({
      data: elapsed.map((subscription) => ({
        supplierCompanyId: subscription.supplierCompanyId,
        action: "BILLING.MEMBERSHIP_EXPIRED",
        entityType: "Subscription",
        entityId: subscription.id,
        summary: "Supplier membership reached its paid-through end date",
        metadata: {
          paidThrough: subscription.currentPeriodEnd?.toISOString() ?? null,
          reconciledAt: now.toISOString(),
        },
      })),
    });

    return { expired: result.count };
  });
}
