import { prisma, runWithDatabaseIdentity } from "@/lib/db";

// Every supplier query accepts a company id sourced from a validated membership.
// Never accept this id directly from an untrusted request body.
export async function getSupplierDashboard(supplierCompanyId: string, userId: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const last30Days = new Date(now.getTime() - 30 * 86_400_000);

  // One short, identity-scoped transaction avoids repeated authentication and
  // connection setup while preserving tenant isolation through RLS.
  return runWithDatabaseIdentity(userId, () => prisma.$transaction(async (tx) => {
    const company = await tx.supplierCompany.findUniqueOrThrow({
      where: { id: supplierCompanyId },
      include: {
        subscription: true,
        categories: true,
        coverageAreas: true,
        memberships: true,
        accreditations: { include: { attachment: true } },
      },
    });
    const assignments = await tx.supplierAssignment.findMany({
      where: {
        supplierCompanyId,
        status: { in: ["PENDING", "VIEWED", "ACCEPTED"] },
        expiresAt: { gt: now },
        quoteRequest: { status: { in: ["OPEN", "MATCHING", "QUOTED"] }, responseDueAt: { gt: now } },
      },
      include: {
        quoteRequest: {
          include: { category: true, items: true, attachments: true },
        },
      },
      orderBy: { assignedAt: "desc" },
      take: 8,
    });
    const openAssignmentCount = await tx.supplierAssignment.count({
      where: {
        supplierCompanyId,
        status: { in: ["PENDING", "VIEWED", "ACCEPTED"] },
        expiresAt: { gt: now },
        quoteRequest: { status: { in: ["OPEN", "MATCHING", "QUOTED"] }, responseDueAt: { gt: now } },
      },
    });
    const recentQuotations = await tx.supplierQuotation.findMany({
      where: {
        supplierCompanyId,
        submittedAt: { gte: last30Days },
        status: { in: ["SUBMITTED", "SELECTED_PENDING_PAYMENT", "ACCEPTED", "REJECTED"] },
      },
      include: { quoteRequest: { select: { reference: true, title: true } } },
      orderBy: { submittedAt: "desc" },
      take: 100,
    });
    const latestWonQuotation = await tx.supplierQuotation.findFirst({
      where: { supplierCompanyId, status: "ACCEPTED" },
      include: { quoteRequest: { select: { reference: true, title: true } } },
      orderBy: { decidedAt: "desc" },
    });
    const recentAssignments = await tx.supplierAssignment.findMany({
      where: { supplierCompanyId, assignedAt: { gte: last30Days } },
      select: { assignedAt: true, respondedAt: true },
      orderBy: { assignedAt: "desc" },
      take: 500,
    });
    const unreadNotificationCount = await tx.notification.count({
      where: { userId, supplierCompanyId, readAt: null },
    });

    const answeredAssignments = recentAssignments.filter((item) => item.respondedAt);
    const responseRate = recentAssignments.length
      ? Math.round((answeredAssignments.length / recentAssignments.length) * 100)
      : 0;
    const averageResponseMs = answeredAssignments.length
      ? Math.round(answeredAssignments.reduce((total, item) => total + (item.respondedAt!.getTime() - item.assignedAt.getTime()), 0) / answeredAssignments.length)
      : null;
    const decided = recentQuotations.filter((item) => ["ACCEPTED", "REJECTED"].includes(item.status));
    const wonThisMonth = recentQuotations.filter((item) => item.status === "ACCEPTED" && item.decidedAt && item.decidedAt >= monthStart);
    const monthValuePence = wonThisMonth.reduce((total, item) => total + Math.round(Number(item.price) * 100), 0);

    return {
      company,
      assignments,
      openAssignmentCount,
      unreadNotificationCount,
      generatedAt: now,
      metrics: {
        openQuotes: recentQuotations.filter((item) => ["SUBMITTED", "SELECTED_PENDING_PAYMENT"].includes(item.status)).length,
        wonThisMonth: wonThisMonth.length,
        responseRate,
        averageResponseMs,
        winRate: decided.length ? Math.round((decided.filter((item) => item.status === "ACCEPTED").length / decided.length) * 100) : null,
        monthValuePence,
      },
      latestWonQuotation,
      recentQuotations: recentQuotations.slice(0, 5),
    };
  }));
}

export async function getSupplierRequest(
  supplierCompanyId: string,
  reference: string,
) {
  return prisma.supplierAssignment.findFirst({
    where: {
      supplierCompanyId,
      quoteRequest: { reference },
      OR: [{ status: { not: "WITHDRAWN" } }, { quotation: { isNot: null } }],
    },
    include: {
      quoteRequest: {
        include: { category: { include: { parent: { select: { slug: true } } } }, items: true, attachments: true },
      },
      quotation: { include: { attachments: true, contactAccess: true } },
    },
  });
}
