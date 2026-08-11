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
    const capacityCompanies = await tx.supplierCompany.findMany({
      where: {
        status: "APPROVED",
        subscription: { is: { status: "ACTIVE", OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }] } },
        capabilities: { some: { active: true, declaredMonthlyCapacity: { not: null } } },
      },
      select: {
        id: true,
        capabilities: { where: { active: true, declaredMonthlyCapacity: { not: null } }, select: { declaredMonthlyCapacity: true } },
        memberships: { where: { status: "ACTIVE" }, select: { userId: true } },
      },
      take: Math.max(1, Math.min(200, limit)),
    });
    const exposureSince = new Date(now.getTime() - 30 * DAY_MS);
    const invitationCounts = capacityCompanies.length ? await tx.supplierAssignment.groupBy({
      by: ["supplierCompanyId"],
      where: { supplierCompanyId: { in: capacityCompanies.map((company) => company.id) }, assignedAt: { gte: exposureSince } },
      _count: { _all: true },
    }) : [];
    const invitationsByCompany = new Map(invitationCounts.map((row) => [row.supplierCompanyId, row._count._all]));
    const warningPercent = configuration?.declaredCapacityWarningPercent ?? 80;
    let capacityNotifications = 0;
    for (const company of capacityCompanies) {
      const declaredCapacity = company.capabilities.reduce((total, capability) => total + (capability.declaredMonthlyCapacity ?? 0), 0);
      if (!declaredCapacity) continue;
      const invitations = invitationsByCompany.get(company.id) ?? 0;
      const usePercent = Math.round(invitations / declaredCapacity * 100);
      if (usePercent < warningPercent) continue;
      const actionUrl = "/dashboard/capabilities?attention=monthly-capacity";
      for (const membership of company.memberships) {
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
            title: "Review your monthly opportunity capacity",
            body: `You have received ${invitations} opportunities in 30 days against your current comfort level of ${declaredCapacity}. Confirm or update your capacity so matching stays accurate.`,
            actionUrl,
          },
        });
        capacityNotifications += 1;
      }
    }
    return { companies: companies.length, notifications: created, capacityNotifications };
  });
}
