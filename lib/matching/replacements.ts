import "server-only";
import { Prisma } from "@prisma/client";
import { runAsDatabaseWorker } from "@/lib/db";
import { evaluateSupplierMatches, resolveDeliveryLocation } from "@/lib/matching/suppliers";
import { recordMatchingEvaluation } from "@/lib/matching/distribution";
import { queueSupplierAssignmentNotifications } from "@/lib/notifications/assignment-notifications";

const ACTIVE_ASSIGNMENT_STATUSES = ["PENDING", "VIEWED", "ACCEPTED"] as const;
const VALID_QUOTATION_STATUSES = ["SUBMITTED", "SELECTED_PENDING_PAYMENT", "ACCEPTED"] as const;

export async function inviteNextEligibleSupplier(quoteRequestId: string, replacementForId?: string) {
  const requestLocation = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.quoteRequest.findUnique({
    where: { id: quoteRequestId },
    select: {
      deliveryPostcode: true, deliveryLatitude: true, deliveryLongitude: true,
      matchingPostcode: true, matchingLatitude: true, matchingLongitude: true,
    },
  }));
  if (!requestLocation) return { invited: false, reason: "request_missing" };
  const resolution = await resolveDeliveryLocation(requestLocation);

  return runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    await tx.$queryRaw`SELECT id FROM bridge_ai."QuoteRequest" WHERE id = ${quoteRequestId} FOR UPDATE`;
    let quote = await tx.quoteRequest.findUnique({ where: { id: quoteRequestId }, include: { items: { select: { quantity: true } } } });
    const configuration = await tx.matchingConfiguration.findUnique({ where: { id: "default" } });
    const now = new Date();
    if (!quote || !["OPEN", "MATCHING", "QUOTED"].includes(quote.status) || quote.responseDueAt <= now) return { invited: false, reason: "request_closed" };
    if ((quote.matchingLatitude === null || quote.matchingLongitude === null)
      && resolution.location.latitude !== null && resolution.location.longitude !== null) {
      quote = await tx.quoteRequest.update({
        where: { id: quote.id },
        data: {
          matchingPostcode: resolution.location.postcode,
          matchingLatitude: resolution.location.latitude,
          matchingLongitude: resolution.location.longitude,
        },
        include: { items: { select: { quantity: true } } },
      });
    }
    if (configuration && !configuration.automaticNextSupplierInvitation) return { invited: false, reason: "automatic_replacement_disabled" };
    const maximumSuppliers = Math.min(quote.distributionLimit, configuration?.maximumSuppliersPerRequest ?? 5, 5);
    const activeAssignments = await tx.supplierAssignment.count({ where: { quoteRequestId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] }, expiresAt: { gt: now } } });
    const validQuotes = await tx.supplierQuotation.count({ where: { quoteRequestId, status: { in: [...VALID_QUOTATION_STATUSES] } } });
    const totalInvitations = await tx.supplierAssignment.count({ where: { quoteRequestId } });
    if (validQuotes >= maximumSuppliers) return { invited: false, reason: "quote_target_reached" };
    if (activeAssignments >= maximumSuppliers) return { invited: false, reason: "active_supplier_limit_reached" };

    const evaluations = await evaluateSupplierMatches(tx, quote, resolution.location);
    const next = evaluations.find((evaluation) => evaluation.outcome === "MATCHED");
    await recordMatchingEvaluation(tx, {
      quoteRequestId,
      categoryId: quote.categoryId,
      deliveryPostcode: quote.deliveryPostcode,
      matchingPostcode: quote.matchingPostcode ?? quote.deliveryPostcode,
      evaluations,
      selectedSupplierIds: next ? [next.id] : [],
      invitedSupplierCount: activeAssignments + (next ? 1 : 0),
      alertOnZero: configuration?.coverageGapAlertsEnabled ?? true,
      preserveExistingSelections: true,
    });
    if (!next) return { invited: false, reason: "no_eligible_supplier" };

    const assignment = await tx.supplierAssignment.create({
      data: {
        quoteRequestId,
        supplierCompanyId: next.id,
        status: "PENDING",
        expiresAt: quote.responseDueAt,
        assignedById: null,
        invitationRank: totalInvitations + 1,
        replacementForId: replacementForId ?? null,
        marketDensityMode: next.marketDensityMode,
        softCapOverride: next.softCapOverride,
      },
    });
    await queueSupplierAssignmentNotifications(tx, {
      supplierCompanyIds: [next.id],
      reference: quote.reference,
      title: quote.title,
      responseDueAt: quote.responseDueAt,
    });
    await tx.auditLog.create({ data: { supplierCompanyId: next.id, action: "MATCHING.REPLACEMENT_SUPPLIER_INVITED", entityType: "SupplierAssignment", entityId: assignment.id, summary: "Next-ranked eligible supplier invited automatically", metadata: { quoteRequestId, invitationRank: assignment.invitationRank, replacementForId: replacementForId ?? null, score: next.score, reasons: next.reasons } as Prisma.InputJsonValue } });
    return { invited: true, supplierCompanyId: next.id, assignmentId: assignment.id, invitationRank: assignment.invitationRank };
  });
}

export async function expireAndReplaceSupplierInvitations({ limit = 25 }: { limit?: number } = {}) {
  const now = new Date();
  const expired = await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
    const candidates = await tx.supplierAssignment.findMany({
      where: {
        status: { in: ["PENDING", "VIEWED"] },
        expiresAt: { lte: now },
        quoteRequest: { status: { in: ["OPEN", "MATCHING", "QUOTED"] }, responseDueAt: { gt: now } },
      },
      orderBy: { expiresAt: "asc" },
      take: Math.max(1, Math.min(100, limit)),
      select: { id: true, quoteRequestId: true, supplierCompanyId: true },
    });
    const claimed: typeof candidates = [];
    for (const candidate of candidates) {
      const updated = await tx.supplierAssignment.updateMany({
        where: { id: candidate.id, status: { in: ["PENDING", "VIEWED"] }, expiresAt: { lte: now } },
        data: { status: "EXPIRED", respondedAt: now, declinedReason: "Supplier response window expired" },
      });
      if (!updated.count) continue;
      claimed.push(candidate);
      await tx.auditLog.create({
        data: {
          supplierCompanyId: candidate.supplierCompanyId,
          action: "MATCHING.SUPPLIER_INVITATION_EXPIRED",
          entityType: "SupplierAssignment",
          entityId: candidate.id,
          summary: "Supplier invitation expired and was released for replacement",
          metadata: { quoteRequestId: candidate.quoteRequestId } as Prisma.InputJsonValue,
        },
      });
    }
    return claimed;
  });

  let replacements = 0;
  for (const candidate of expired) {
    const result = await inviteNextEligibleSupplier(candidate.quoteRequestId, candidate.id);
    if (result.invited) replacements += 1;
  }
  return { expired: expired.length, replacements };
}
