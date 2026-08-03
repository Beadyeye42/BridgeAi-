import "server-only";
import { Prisma } from "@prisma/client";
import { trustedPrisma } from "@/lib/db";
import { addSupplierResponseHours } from "@/lib/quotes/response-clock";

export async function selectQuotationForCustomer(input: {
  quotationId: string;
  actorUserId: string;
  evidence: string;
}) {
  const selectedAt = new Date();
  const paymentDueAt = addSupplierResponseHours(selectedAt, 2);
  return trustedPrisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bridge_ai."SupplierQuotation" WHERE id = ${input.quotationId} FOR UPDATE`;
    const quotation = await tx.supplierQuotation.findUnique({
      where: { id: input.quotationId },
      include: { quoteRequest: true },
    });
    if (!quotation) throw new Error("QUOTATION_NOT_FOUND");
    if (quotation.status !== "SUBMITTED") throw new Error("QUOTATION_NOT_SELECTABLE");
    if (!["OPEN", "MATCHING", "QUOTED"].includes(quotation.quoteRequest.status)) throw new Error("REQUEST_NOT_SELECTABLE");
    await tx.$executeRaw`SELECT set_config('bridge_ai.payment_transition', 'on', true)`;
    const fee = await tx.supplierSuccessFee.create({
      data: {
        quotationId: quotation.id,
        quoteRequestId: quotation.quoteRequestId,
        supplierCompanyId: quotation.supplierCompanyId,
        amountPence: 2500,
        selectedAt,
        paymentDueAt,
      },
    });
    await tx.supplierQuotation.update({
      where: { id: quotation.id },
      data: { status: "SELECTED_PENDING_PAYMENT", decidedAt: selectedAt },
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
          type: "SUCCESS_FEE_DUE" as const,
          title: "Your quote was selected",
          body: "Pay the £25 success fee before the deadline to unlock the customer details.",
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
        summary: "Customer selection recorded; success fee is pending",
        metadata: { evidence: input.evidence.slice(0, 250), paymentDueAt: paymentDueAt.toISOString(), amountPence: 2500 },
      },
    });
    return fee;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
}

export async function unlockPaidQuotation(input: {
  successFeeId: string;
  paymentIntentId: string;
  paidAt: Date;
}) {
  return trustedPrisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bridge_ai."SupplierSuccessFee" WHERE id = ${input.successFeeId} FOR UPDATE`;
    const fee = await tx.supplierSuccessFee.findUnique({
      where: { id: input.successFeeId },
      include: { quotation: true, quoteRequest: true },
    });
    if (!fee) throw new Error("SUCCESS_FEE_NOT_FOUND");
    if (fee.status === "PAID") return { duplicate: true, fee };
    if (!["PENDING", "CHECKOUT_CREATED", "EXPIRED"].includes(fee.status)) throw new Error("SUCCESS_FEE_NOT_PAYABLE");
    if (input.paidAt > fee.paymentDueAt) throw new Error("SUCCESS_FEE_PAID_AFTER_DEADLINE");
    await tx.$executeRaw`SELECT set_config('bridge_ai.payment_transition', 'on', true)`;
    const paidFee = await tx.supplierSuccessFee.update({
      where: { id: fee.id },
      data: { status: "PAID", providerPaymentIntentId: input.paymentIntentId, paidAt: input.paidAt, unlockedAt: input.paidAt, expiredAt: null },
    });
    await tx.contactAccessGrant.create({
      data: {
        successFeeId: fee.id,
        quotationId: fee.quotationId,
        customerContactId: fee.quoteRequest.customerContactId,
        supplierCompanyId: fee.supplierCompanyId,
      },
    });
    await tx.supplierQuotation.update({ where: { id: fee.quotationId }, data: { status: "ACCEPTED", decidedAt: input.paidAt } });
    await tx.supplierQuotation.updateMany({
      where: { quoteRequestId: fee.quoteRequestId, id: { not: fee.quotationId }, status: "SUBMITTED" },
      data: { status: "REJECTED", decidedAt: input.paidAt },
    });
    await tx.quoteRequest.update({ where: { id: fee.quoteRequestId }, data: { status: "WON", closedAt: input.paidAt } });
    const members = await tx.supplierTeamMembership.findMany({
      where: { supplierCompanyId: fee.supplierCompanyId, status: "ACTIVE" }, select: { userId: true },
    });
    if (members.length) await tx.notification.createMany({ data: members.map(({ userId }) => ({
      userId,
      supplierCompanyId: fee.supplierCompanyId,
      type: "CONTACT_DETAILS_UNLOCKED" as const,
      title: "Customer details unlocked",
      body: "Payment is confirmed. Open the request to view the customer contact details.",
      actionUrl: `/dashboard/requests/${fee.quoteRequest.reference}`,
    })) });
    await tx.auditLog.create({ data: {
      supplierCompanyId: fee.supplierCompanyId,
      action: "CONTACT_ACCESS.GRANTED",
      entityType: "ContactAccessGrant",
      entityId: fee.quotationId,
      summary: "Verified success-fee payment unlocked customer contact details",
      metadata: { successFeeId: fee.id, paymentIntentId: input.paymentIntentId },
    } });
    return { duplicate: false, fee: paidFee };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
}

export async function expireOverdueSuccessFees(now = new Date()) {
  return trustedPrisma.$transaction(async (tx) => {
    // Keep a short webhook-delivery grace period after the visible deadline so
    // an on-time Stripe payment is not displaced while its event is in flight.
    const expiryCutoff = new Date(now.getTime() - 15 * 60 * 1000);
    const overdue = await tx.supplierSuccessFee.findMany({
      where: { status: { in: ["PENDING", "CHECKOUT_CREATED"] }, paymentDueAt: { lte: expiryCutoff } },
      select: { id: true, quotationId: true, supplierCompanyId: true },
      take: 100,
    });
    for (const fee of overdue) {
      await tx.supplierSuccessFee.update({ where: { id: fee.id }, data: { status: "EXPIRED", expiredAt: now } });
      await tx.supplierQuotation.updateMany({ where: { id: fee.quotationId, status: "SELECTED_PENDING_PAYMENT" }, data: { status: "EXPIRED" } });
      await tx.auditLog.create({ data: { supplierCompanyId: fee.supplierCompanyId, action: "BILLING.SUCCESS_FEE_EXPIRED", entityType: "SupplierSuccessFee", entityId: fee.id, summary: "Success-fee payment window expired without contact release" } });
    }
    return overdue.length;
  });
}
