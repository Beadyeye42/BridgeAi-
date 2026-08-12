import "server-only";
import { Prisma } from "@prisma/client";
import { postcodeOutwardCode } from "@/lib/location/postcodes";
import type { SupplierEvaluation } from "@/lib/matching/suppliers";
import { writeWhatsAppSystemEvent } from "@/lib/whatsapp/system-events";

/**
 * Lock suppliers in a stable order before creating several invitations.
 * The database trigger takes the same supplier-scoped advisory locks, so this
 * prevents two concurrent request distributions from acquiring them in an
 * opposite order and deadlocking.
 */
export async function lockSupplierAssignmentScope(
  tx: Prisma.TransactionClient,
  supplierCompanyIds: Iterable<string>,
) {
  const sortedIds = [...new Set(supplierCompanyIds)].sort();
  for (const supplierCompanyId of sortedIds) {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${'supplier:' + supplierCompanyId}, 0)
      )
    `;
  }
}

export async function recordMatchingEvaluation(
  tx: Prisma.TransactionClient,
  input: {
    quoteRequestId: string;
    categoryId: string;
    deliveryPostcode: string;
    evaluations: SupplierEvaluation[];
    selectedSupplierIds: Iterable<string>;
    invitedSupplierCount?: number;
    alertOnZero?: boolean;
    preserveExistingSelections?: boolean;
  },
) {
  const selected = new Set(input.selectedSupplierIds);
  const consideredSupplierCount = input.evaluations.length;
  const eligibleSupplierCount = input.evaluations.filter((evaluation) => evaluation.mandatoryEligible).length;
  const eliminatedSupplierCount = consideredSupplierCount - eligibleSupplierCount;
  const density = input.evaluations[0]?.marketDensityMode ?? "EMPTY";
  const fairnessInfluence = input.evaluations.some((evaluation) => evaluation.fairnessAdjustment > 0)
    ? `${density.toLowerCase()}-market exposure balancing applied only among similarly qualified suppliers`
    : `${density.toLowerCase()}-market ranking used mandatory capability, geography, capacity and membership checks`;
  const existingInvitations = input.invitedSupplierCount ?? await tx.supplierAssignment.count({
    where: { quoteRequestId: input.quoteRequestId, status: { in: ["PENDING", "VIEWED", "ACCEPTED"] } },
  });
  const invitedSupplierCount = Math.min(5, Math.max(existingInvitations, selected.size));

  await tx.quoteRequest.update({
    where: { id: input.quoteRequestId },
    data: {
      marketDensityMode: density,
      consideredSupplierCount,
      eliminatedSupplierCount,
      eligibleSupplierCount,
      invitedSupplierCount,
      fairnessInfluence,
      matchingEvaluatedAt: new Date(),
    },
  });

  for (const evaluation of input.evaluations) {
    await tx.supplierMatchDecision.upsert({
      where: {
        quoteRequestId_supplierCompanyId: {
          quoteRequestId: input.quoteRequestId,
          supplierCompanyId: evaluation.id,
        },
      },
      create: {
        quoteRequestId: input.quoteRequestId,
        supplierCompanyId: evaluation.id,
        outcome: evaluation.outcome,
        score: evaluation.score,
        baseScore: evaluation.baseScore,
        fairnessAdjustment: evaluation.fairnessAdjustment,
        selected: selected.has(evaluation.id),
        marketDensityMode: density,
        invitationReason: selected.has(evaluation.id) ? evaluation.invitationReason : null,
        rejectionReason: evaluation.outcome === "REJECTED" ? evaluation.rejectionReason : null,
        reasons: evaluation.reasons,
        capabilitySnapshot: evaluation.capabilitySnapshot,
        membershipTier: evaluation.membershipTier,
        coveragePurpose: evaluation.coveragePurpose,
        distanceMiles: evaluation.distanceMiles,
        rankingSnapshot: evaluation.rankingSnapshot,
      },
      update: {
        outcome: evaluation.outcome,
        score: evaluation.score,
        baseScore: evaluation.baseScore,
        fairnessAdjustment: evaluation.fairnessAdjustment,
        selected: input.preserveExistingSelections && !selected.has(evaluation.id) ? undefined : selected.has(evaluation.id),
        marketDensityMode: density,
        invitationReason: selected.has(evaluation.id) ? evaluation.invitationReason : null,
        rejectionReason: evaluation.outcome === "REJECTED" ? evaluation.rejectionReason : null,
        reasons: evaluation.reasons,
        capabilitySnapshot: evaluation.capabilitySnapshot,
        membershipTier: evaluation.membershipTier,
        coveragePurpose: evaluation.coveragePurpose,
        distanceMiles: evaluation.distanceMiles,
        rankingSnapshot: evaluation.rankingSnapshot,
        decidedAt: new Date(),
      },
    });
  }

  const existingGap = await tx.coverageGapSignal.findUnique({ where: { quoteRequestId: input.quoteRequestId } });
  if (eligibleSupplierCount <= 2) {
    await tx.coverageGapSignal.upsert({
      where: { quoteRequestId: input.quoteRequestId },
      create: {
        quoteRequestId: input.quoteRequestId,
        categoryId: input.categoryId,
        deliveryOutwardCode: postcodeOutwardCode(input.deliveryPostcode),
        eligibleSupplierCount,
        marketDensityMode: density,
      },
      update: {
        eligibleSupplierCount,
        marketDensityMode: density,
        deliveryOutwardCode: postcodeOutwardCode(input.deliveryPostcode),
        status: "OPEN",
        lastDetectedAt: new Date(),
        resolvedAt: null,
      },
    });
    if (!existingGap && eligibleSupplierCount === 0 && input.alertOnZero) {
      await writeWhatsAppSystemEvent(tx, "whatsapp_ai", {
        severity: "WARNING",
        code: "MATCHING_ZERO_ELIGIBLE_SUPPLIERS",
        message: "A confirmed request has no eligible suppliers after mandatory matching filters",
        context: {
          quoteRequestId: input.quoteRequestId,
          categoryId: input.categoryId,
          deliveryOutwardCode: postcodeOutwardCode(input.deliveryPostcode),
        },
      });
    }
  } else if (existingGap?.status === "OPEN") {
    await tx.coverageGapSignal.update({
      where: { quoteRequestId: input.quoteRequestId },
      data: { status: "RESOLVED", resolvedAt: new Date(), lastDetectedAt: new Date() },
    });
  }

  return { density, consideredSupplierCount, eliminatedSupplierCount, eligibleSupplierCount, invitedSupplierCount };
}
