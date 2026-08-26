import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, runAsDatabaseWorker, runWithDatabaseIdentity } from "@/lib/db";
import { initialLifecycleStage, resolveBuyerExperience } from "@/lib/buyer/industry-experience";

async function writeSelectionAudit(
  tx: Prisma.TransactionClient,
  input: { action: string; entityType: string; entityId: string; summary: string; metadata: Prisma.InputJsonValue },
) {
  await tx.$queryRaw`
    SELECT bridge_private.write_whatsapp_audit(
      ${input.action}, ${input.entityType}, ${input.entityId}, ${input.summary},
      ${JSON.stringify(input.metadata)}::jsonb
    )
  `;
}

function buyerOrderReference() {
  return `BO-${randomBytes(6).toString("hex").toUpperCase()}`;
}

export async function selectQuotationForCustomer(input: {
  quotationId: string;
  actorUserId?: string;
  buyerAuthUserId?: string;
  buyerCustomerContactId?: string;
  source?: "WHATSAPP" | "BUYER_PORTAL";
  evidence: string;
}) {
  const selectedAt = new Date();
  const selectInTransaction = async (tx: Prisma.TransactionClient) => {
    const located = await tx.supplierQuotation.findUnique({
      where: { id: input.quotationId },
      select: { quoteRequestId: true },
    });
    if (!located) throw new Error("QUOTATION_NOT_FOUND");
    await tx.$queryRaw`SELECT id FROM bridge_ai."QuoteRequest" WHERE id = ${located.quoteRequestId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM bridge_ai."SupplierQuotation" WHERE id = ${input.quotationId} FOR UPDATE`;
    const quotation = await tx.supplierQuotation.findUnique({
      where: { id: input.quotationId },
      include: { quoteRequest: { include: { category: { include: { parent: { select: { buyerExperienceConfig: true } } } } } } },
    });
    if (!quotation) throw new Error("QUOTATION_NOT_FOUND");
    if (input.source === "BUYER_PORTAL" && (
      !input.buyerAuthUserId
      || !input.buyerCustomerContactId
      || quotation.quoteRequest.customerContactId !== input.buyerCustomerContactId
    )) throw new Error("BUYER_SELECTION_SCOPE_MISMATCH");
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
      where: {
        quoteRequestId: quotation.quoteRequestId,
        id: { not: quotation.id },
        status: { in: ["DRAFT", "SUBMITTED", "SELECTED_PENDING_PAYMENT"] },
      },
      data: { status: "REJECTED", decidedAt: selectedAt },
    });
    await tx.supplierAssignment.updateMany({
      where: {
        quoteRequestId: quotation.quoteRequestId,
        id: { not: quotation.assignmentId },
        status: { not: "WITHDRAWN" },
      },
      data: { status: "WITHDRAWN" },
    });
    await tx.quoteRequest.update({
      where: { id: quotation.quoteRequestId },
      data: { status: "SELECTED", selectedAt, closedAt: null },
    });
    await tx.quoteConversation.updateMany({
      where: { quoteRequestId: quotation.quoteRequestId, quotationId: { not: quotation.id } },
      data: { status: "CLOSED", closedAt: selectedAt },
    });
    await tx.quoteConversation.updateMany({
      where: { quoteRequestId: quotation.quoteRequestId, quotationId: quotation.id },
      data: { status: "SELECTED", closedAt: selectedAt },
    });
    await tx.quoteSelectionEvent.create({
      data: {
        quoteRequestId: quotation.quoteRequestId,
        quotationId: quotation.id,
        eventType: "CUSTOMER_SELECTED",
        evidence: input.evidence.slice(0, 250),
      },
    });
    const experience = resolveBuyerExperience(quotation.quoteRequest.category);
    const initialStage = initialLifecycleStage(experience);
    const nextStep = initialStage.nextAction ?? "Contact the buyer and agree the final arrangements.";
    const buyerOrder = await tx.buyerOrder.create({
      data: {
        reference: buyerOrderReference(),
        customerContactId: quotation.quoteRequest.customerContactId,
        quoteRequestId: quotation.quoteRequestId,
        quotationId: quotation.id,
        supplierCompanyId: quotation.supplierCompanyId,
        state: initialStage.state,
        stageKey: initialStage.key,
        nextAction: nextStep,
        events: {
          create: {
            state: initialStage.state,
            stageKey: initialStage.key,
            title: initialStage.label,
            detail: nextStep,
            source: input.actorUserId ? "ADMIN" : input.source ?? "WHATSAPP",
            actorAuthUserId: input.actorUserId ?? input.buyerAuthUserId,
          },
        },
      },
    });

    if (quotation.quoteRequest.conversationId) {
      await tx.whatsAppJob.upsert({
        where: { idempotencyKey: `contact-unlock:${grant.id}` },
        create: {
          type: "SEND_CONTACT_UNLOCK",
          idempotencyKey: `contact-unlock:${grant.id}`,
          conversationId: quotation.quoteRequest.conversationId,
          quoteRequestId: quotation.quoteRequestId,
          quotationId: quotation.id,
        },
        update: {},
      });
    }

    const members = await tx.supplierTeamMembership.findMany({
      where: { supplierCompanyId: quotation.supplierCompanyId, status: "ACTIVE" },
      select: { userId: true },
    });
    const preferences = members.length ? await tx.notificationPreference.findMany({
      where: { supplierCompanyId: quotation.supplierCompanyId, userId: { in: members.map(({ userId }) => userId) } },
      select: { userId: true, emailQuotationUpdates: true },
    }) : [];
    const preferenceByUserId = new Map(preferences.map((preference) => [preference.userId, preference]));
    if (members.length) {
      await tx.notification.createMany({
        data: members.map(({ userId }) => ({
          userId,
          supplierCompanyId: quotation.supplierCompanyId,
          type: "CONTACT_DETAILS_UNLOCKED" as const,
          title: "Your quote was selected",
          body: `Good news—the customer selected your quote to move forward. Next step: ${nextStep}`,
          actionUrl: `/dashboard/requests/${quotation.quoteRequest.reference}`,
        })),
      });
      const emailRecipients = members.filter(({ userId }) => preferenceByUserId.get(userId)?.emailQuotationUpdates !== false);
      if (emailRecipients.length) {
        await tx.notification.createMany({
          data: emailRecipients.map(({ userId }) => ({
            userId,
            supplierCompanyId: quotation.supplierCompanyId,
            type: "QUOTATION_ACCEPTED" as const,
            channel: "EMAIL" as const,
            title: `Your quote was selected for ${quotation.quoteRequest.reference}`,
            body: `The customer selected your quotation to move forward. Sign in to view the customer details. Next step: ${nextStep}`,
            actionUrl: `/dashboard/requests/${quotation.quoteRequest.reference}`,
          })),
          skipDuplicates: true,
        });
      }
    }
    if (input.actorUserId) {
      await tx.auditLog.createMany({
        data: [{
          actorUserId: input.actorUserId,
          supplierCompanyId: quotation.supplierCompanyId,
          action: "QUOTATION.CUSTOMER_SELECTED",
          entityType: "SupplierQuotation",
          entityId: quotation.id,
          summary: "Customer selection recorded and contact access granted without a winning fee",
          metadata: { evidence: input.evidence.slice(0, 250), contactAccessGrantId: grant.id, buyerOrderId: buyerOrder.id },
        }, {
          actorUserId: input.actorUserId,
          supplierCompanyId: quotation.supplierCompanyId,
          action: "CONTACT_ACCESS.GRANTED",
          entityType: "ContactAccessGrant",
          entityId: grant.id,
          summary: "Customer selection unlocked contact details with no introduction or winning fee",
          metadata: { quotationId: quotation.id, quoteRequestId: quotation.quoteRequestId },
        }],
      });
    } else if (input.source === "BUYER_PORTAL") {
      await tx.buyerSecurityEvent.create({
        data: {
          customerContactId: quotation.quoteRequest.customerContactId,
          authUserId: input.buyerAuthUserId,
          eventType: "BUYER_PORTAL_QUOTATION_SELECTED",
          metadata: { quotationId: quotation.id, quoteRequestId: quotation.quoteRequestId, buyerOrderId: buyerOrder.id },
        },
      });
    } else {
      await writeSelectionAudit(tx, {
        action: "WHATSAPP.CUSTOMER_SELECTION_RECORDED",
        entityType: "SupplierQuotation",
        entityId: quotation.id,
        summary: "Customer selection recorded and contact access granted without a winning fee",
        metadata: { evidence: input.evidence.slice(0, 250), contactAccessGrantId: grant.id, quoteRequestId: quotation.quoteRequestId, buyerOrderId: buyerOrder.id },
      });
    }
    return grant;
  };

  if (!input.actorUserId) {
    // Selection is a privileged, multi-table server operation. Buyer Hub calls
    // prove ownership again inside the locked transaction before any write, so
    // they can safely reuse the narrowly scoped WhatsApp selection worker.
    // Running this as buyer_auth would require broad buyer write policies on
    // contact grants, assignments, quotations and notifications.
    return runAsDatabaseWorker("whatsapp_ai", selectInTransaction);
  }
  return runWithDatabaseIdentity(input.actorUserId, () => prisma.$transaction(
    selectInTransaction,
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 },
  ));
}
