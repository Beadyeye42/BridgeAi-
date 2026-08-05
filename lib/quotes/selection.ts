import "server-only";
import { Prisma } from "@prisma/client";
import { trustedPrisma } from "@/lib/db";

export async function selectQuotationForCustomer(input: {
  quotationId: string;
  actorUserId?: string;
  evidence: string;
}) {
  const selectedAt = new Date();
  return trustedPrisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bridge_ai."SupplierQuotation" WHERE id = ${input.quotationId} FOR UPDATE`;
    const quotation = await tx.supplierQuotation.findUnique({
      where: { id: input.quotationId },
      include: { quoteRequest: true },
    });
    if (!quotation) throw new Error("QUOTATION_NOT_FOUND");
    if (quotation.status !== "SUBMITTED") throw new Error("QUOTATION_NOT_SELECTABLE");
    if (quotation.validUntil && quotation.validUntil <= selectedAt) throw new Error("QUOTATION_EXPIRED");
    if (!["OPEN", "MATCHING", "QUOTED"].includes(quotation.quoteRequest.status)) throw new Error("REQUEST_NOT_SELECTABLE");

    await tx.$executeRaw`SELECT set_config('bridge_ai.payment_transition', 'on', true)`;
    const grant = await tx.contactAccessGrant.create({
      data: {
        quotationId: quotation.id,
        customerContactId: quotation.quoteRequest.customerContactId,
        supplierCompanyId: quotation.supplierCompanyId,
        reason: "CUSTOMER_SELECTED",
      },
    });
    await tx.supplierQuotation.update({
      where: { id: quotation.id },
      data: { status: "ACCEPTED", decidedAt: selectedAt },
    });
    await tx.supplierQuotation.updateMany({
      where: { quoteRequestId: quotation.quoteRequestId, id: { not: quotation.id }, status: "SUBMITTED" },
      data: { status: "REJECTED", decidedAt: selectedAt },
    });
    await tx.quoteRequest.update({
      where: { id: quotation.quoteRequestId },
      data: { status: "WON", closedAt: selectedAt },
    });

    const members = await tx.supplierTeamMembership.findMany({
      where: { supplierCompanyId: quotation.supplierCompanyId, status: "ACTIVE" },
      select: { userId: true },
    });
    if (members.length) {
      await tx.notification.createMany({
        data: members.map(({ userId }) => ({
          userId,
          supplierCompanyId: quotation.supplierCompanyId,
          type: "CONTACT_DETAILS_UNLOCKED" as const,
          title: "Your quote was selected",
          body: "The customer selected your quotation. Open the request to view their contact details—there is no winning fee.",
          actionUrl: `/dashboard/requests/${quotation.quoteRequest.reference}`,
        })),
      });
    }
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        supplierCompanyId: quotation.supplierCompanyId,
        action: "QUOTATION.CUSTOMER_SELECTED",
        entityType: "SupplierQuotation",
        entityId: quotation.id,
        summary: "Customer selection recorded and contact access granted without a winning fee",
        metadata: { evidence: input.evidence.slice(0, 250), contactAccessGrantId: grant.id },
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        supplierCompanyId: quotation.supplierCompanyId,
        action: "CONTACT_ACCESS.GRANTED",
        entityType: "ContactAccessGrant",
        entityId: grant.id,
        summary: "Customer selection unlocked contact details with no introduction or winning fee",
        metadata: { quotationId: quotation.id, quoteRequestId: quotation.quoteRequestId },
      },
    });
    return grant;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
}
