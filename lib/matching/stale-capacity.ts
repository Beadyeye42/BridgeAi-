import "server-only";
import { runAsDatabaseWorker } from "@/lib/db";

const DAY_MS = 86_400_000;

export async function notifySuppliersWithStaleCapacity({ limit = 50 }: { limit?: number } = {}) {
  return runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    const configuration = await tx.matchingConfiguration.findUnique({ where: { id: "default" } });
    const now = new Date();
    const capacityBefore = new Date(now.getTime() - (configuration?.capacityStaleDays ?? 7) * DAY_MS);
    const leadTimeBefore = new Date(now.getTime() - (configuration?.leadTimeStaleDays ?? 14) * DAY_MS);
    const companies = await tx.supplierCompany.findMany({
      where: {
        status: "APPROVED",
        subscription: { is: { status: "ACTIVE", OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }] } },
        capabilities: { some: { active: true, OR: [{ capacityLastConfirmedAt: { lt: capacityBefore } }, { leadTimeLastConfirmedAt: { lt: leadTimeBefore } }] } },
      },
      select: { id: true, memberships: { where: { status: "ACTIVE" }, select: { userId: true } } },
      take: Math.max(1, Math.min(200, limit)),
    });
    let created = 0;
    for (const company of companies) {
      for (const membership of company.memberships) {
        const actionUrl = "/dashboard/capabilities";
        const existing = await tx.notification.findFirst({
          where: { userId: membership.userId, supplierCompanyId: company.id, type: "ACCOUNT_UPDATE", actionUrl, readAt: null },
          select: { id: true },
        });
        if (existing) continue;
        await tx.notification.create({
          data: {
            userId: membership.userId,
            supplierCompanyId: company.id,
            type: "ACCOUNT_UPDATE",
            channel: "IN_APP",
            title: "Please confirm your capacity and lead times",
            body: "Some live capability information is stale. Confirm it now so Bridge AI does not rely on old availability when matching requests.",
            actionUrl,
          },
        });
        created += 1;
      }
    }
    return { companies: companies.length, notifications: created };
  });
}
