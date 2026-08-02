import { prisma } from "@/lib/db";

// Every supplier query accepts a company id sourced from a validated membership.
// Never accept this id directly from an untrusted request body.
export async function getSupplierDashboard(supplierCompanyId: string) {
  const now = new Date();
  // The production pool is intentionally small. Run these RLS-scoped queries
  // sequentially so each request does not compete with itself for connections.
  const company = await prisma.supplierCompany.findUniqueOrThrow({
    where: { id: supplierCompanyId },
    include: { subscription: true },
  });
  const assignments = await prisma.supplierAssignment.findMany({
    where: {
      supplierCompanyId,
      status: { in: ["PENDING", "VIEWED", "ACCEPTED"] },
      expiresAt: { gt: now },
    },
    include: {
      quoteRequest: {
        include: { category: true, items: true, attachments: true },
      },
    },
    orderBy: { assignedAt: "desc" },
    take: 8,
  });
  const submittedCount = await prisma.supplierQuotation.count({
    where: {
      supplierCompanyId,
      status: { in: ["SUBMITTED", "ACCEPTED", "REJECTED"] },
    },
  });
  const wonCount = await prisma.supplierQuotation.count({
    where: { supplierCompanyId, status: "ACCEPTED" },
  });

  return { company, assignments, submittedCount, wonCount, generatedAt: now };
}

export async function getSupplierRequest(
  supplierCompanyId: string,
  reference: string,
) {
  return prisma.supplierAssignment.findFirst({
    where: { supplierCompanyId, quoteRequest: { reference } },
    include: {
      quoteRequest: {
        include: { category: true, items: true, attachments: true },
      },
      quotation: { include: { attachments: true } },
    },
  });
}
