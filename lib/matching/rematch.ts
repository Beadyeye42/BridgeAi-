import "server-only";
import { runAsDatabaseWorker } from "@/lib/db";
import { evaluateSupplierMatches, resolveDeliveryLocation, selectAdaptiveSupplierMatches } from "@/lib/matching/suppliers";
import { recordMatchingEvaluation } from "@/lib/matching/distribution";
import { queueSupplierAssignmentNotifications } from "@/lib/notifications/assignment-notifications";
import { addSupplierResponseHours } from "@/lib/quotes/response-clock";
import { resolveIndustryResponseDeadlines } from "@/lib/matching/deadlines";

const MAX_AUTOMATIC_SUPPLIERS = 5;
const MAX_REQUESTS_PER_RECHECK = 50;

export type SupplierRematchResult = {
  checked: number;
  matched: number;
  blocked: number;
  blockingReasons: string[];
};

type RematchOptions = {
  supplierCompanyId: string;
  categoryIds: string[];
  actorUserId: string;
};

/**
 * Re-evaluate still-open requests after a supplier confirms capability data.
 * The supplier never chooses or claims a request: the trusted matching worker
 * applies the same mandatory filters used when WhatsApp first publishes it.
 */
export async function rematchOpenRequestsForSupplier({
  supplierCompanyId,
  categoryIds,
  actorUserId,
}: RematchOptions): Promise<SupplierRematchResult> {
  const uniqueCategoryIds = [...new Set(categoryIds)];
  if (!uniqueCategoryIds.length) return { checked: 0, matched: 0, blocked: 0, blockingReasons: [] };

  const now = new Date();
  const candidates = await runAsDatabaseWorker("whatsapp_ai", (tx) => tx.quoteRequest.findMany({
    where: {
      status: { in: ["OPEN", "MATCHING"] },
      responseDueAt: { gt: now },
      assignments: { none: { supplierCompanyId } },
      OR: [
        { categoryId: { in: uniqueCategoryIds } },
        { category: { parentId: { in: uniqueCategoryIds } } },
        { category: { children: { some: { id: { in: uniqueCategoryIds } } } } },
      ],
    },
    select: {
      id: true,
      deliveryPostcode: true,
      deliveryLatitude: true,
      deliveryLongitude: true,
    },
    orderBy: [{ publishedAt: "asc" }, { createdAt: "asc" }],
    take: MAX_REQUESTS_PER_RECHECK,
  }));

  let matched = 0;
  let blocked = 0;
  const blockingReasons = new Set<string>();

  for (const candidate of candidates) {
    const resolution = await resolveDeliveryLocation(candidate);
    const result = await runAsDatabaseWorker("whatsapp_ai", async (tx) => {
      await tx.$queryRaw`SELECT id FROM bridge_ai."QuoteRequest" WHERE id = ${candidate.id} FOR UPDATE`;
      let quote = await tx.quoteRequest.findUnique({
        where: { id: candidate.id },
        include: { items: { select: { quantity: true } } },
      });
      if (!quote || !["OPEN", "MATCHING"].includes(quote.status) || quote.responseDueAt <= new Date()) {
        return { outcome: "SKIPPED" as const, reasons: [] as string[] };
      }
      if ((quote.deliveryLatitude === null || quote.deliveryLongitude === null)
        && resolution.location.latitude !== null && resolution.location.longitude !== null) {
        quote = await tx.quoteRequest.update({
          where: { id: quote.id },
          data: { deliveryLatitude: resolution.location.latitude, deliveryLongitude: resolution.location.longitude },
          include: { items: { select: { quantity: true } } },
        });
      }

      const assignmentCount = await tx.supplierAssignment.count({
        where: { quoteRequestId: quote.id, status: { not: "WITHDRAWN" } },
      });
      if (assignmentCount >= Math.min(quote.distributionLimit, MAX_AUTOMATIC_SUPPLIERS)) {
        return { outcome: "SKIPPED" as const, reasons: [] as string[] };
      }

      const evaluations = await evaluateSupplierMatches(tx, quote, resolution.location);
      const availableSlots = Math.max(0, Math.min(quote.distributionLimit, MAX_AUTOMATIC_SUPPLIERS) - assignmentCount);
      const selectedCandidates = selectAdaptiveSupplierMatches(evaluations, availableSlots);
      const evaluation = evaluations.find((candidate) => candidate.id === supplierCompanyId);
      if (!evaluation) {
        return {
          outcome: "BLOCKED" as const,
          reasons: ["Company approval, membership, subscription, category or coverage is not currently eligible"],
        };
      }

      const selected = evaluation.outcome === "MATCHED" && selectedCandidates.some((candidate) => candidate.id === supplierCompanyId);
      await recordMatchingEvaluation(tx, {
        quoteRequestId: quote.id,
        categoryId: quote.categoryId,
        deliveryPostcode: quote.deliveryPostcode,
        evaluations,
        selectedSupplierIds: selected ? [supplierCompanyId] : [],
        invitedSupplierCount: assignmentCount + (selected ? 1 : 0),
        preserveExistingSelections: true,
      });

      if (!selected) return {
        outcome: "BLOCKED" as const,
        reasons: evaluation.outcome === "MATCHED"
          ? ["Supplier ranked outside the currently available invitation slots"]
          : evaluation.reasons,
      };

      const matchingConfiguration = await tx.matchingConfiguration.findUnique({ where: { id: "default" } });
      const deadlines = await resolveIndustryResponseDeadlines(tx, quote.categoryId, {
        acknowledgementHours: matchingConfiguration?.acknowledgementDeadlineHours
          ?? matchingConfiguration?.responseDeadlineHours
          ?? 8,
        quotationHours: matchingConfiguration?.quotationDeadlineHours
          ?? matchingConfiguration?.responseDeadlineHours
          ?? 24,
      });
      const acknowledgementDueAt = addSupplierResponseHours(
        new Date(),
        deadlines.acknowledgementHours,
      );
      const invitationExpiresAt = acknowledgementDueAt > quote.responseDueAt
        ? quote.responseDueAt
        : acknowledgementDueAt;

      const created = await tx.supplierAssignment.createMany({
        data: [{
          quoteRequestId: quote.id,
          supplierCompanyId,
          status: "PENDING",
          expiresAt: invitationExpiresAt,
          assignedById: null,
          marketDensityMode: evaluation.marketDensityMode,
          softCapOverride: evaluation.softCapOverride,
        }],
        skipDuplicates: true,
      });
      if (!created.count) return { outcome: "SKIPPED" as const, reasons: [] as string[] };

      await queueSupplierAssignmentNotifications(tx, {
        supplierCompanyIds: [supplierCompanyId],
        reference: quote.reference,
        title: quote.title,
        responseDueAt: invitationExpiresAt,
      });
      await tx.quoteRequest.update({ where: { id: quote.id }, data: { status: "MATCHING" } });
      await tx.$queryRaw`
        SELECT bridge_private.write_whatsapp_audit(
          'WHATSAPP.REQUEST_ASSIGNED_AFTER_CAPABILITY_UPDATE',
          'QuoteRequest',
          ${quote.id},
          'Open request assigned after supplier capability confirmation',
          ${JSON.stringify({
            supplierCompanyId,
            actorUserId,
            score: evaluation.score,
            reasons: evaluation.reasons,
            source: "supplier_capability_update",
          })}::jsonb
        )
      `;
      return { outcome: "MATCHED" as const, reasons: evaluation.reasons };
    });

    if (result.outcome === "MATCHED") matched += 1;
    if (result.outcome === "BLOCKED") {
      blocked += 1;
      result.reasons.forEach((reason) => blockingReasons.add(reason));
    }
  }

  return {
    checked: candidates.length,
    matched,
    blocked,
    blockingReasons: [...blockingReasons].slice(0, 3),
  };
}
