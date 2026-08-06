import "server-only";
import { runAsDatabaseWorker } from "@/lib/db";
import { evaluateSupplierMatches, resolveDeliveryLocation } from "@/lib/matching/suppliers";

const MAX_AUTOMATIC_SUPPLIERS = 3;
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
      const quote = await tx.quoteRequest.findUnique({
        where: { id: candidate.id },
        include: { items: { select: { quantity: true } } },
      });
      if (!quote || !["OPEN", "MATCHING"].includes(quote.status) || quote.responseDueAt <= new Date()) {
        return { outcome: "SKIPPED" as const, reasons: [] as string[] };
      }

      const assignmentCount = await tx.supplierAssignment.count({
        where: { quoteRequestId: quote.id, status: { not: "WITHDRAWN" } },
      });
      if (assignmentCount >= Math.min(quote.distributionLimit, MAX_AUTOMATIC_SUPPLIERS)) {
        return { outcome: "SKIPPED" as const, reasons: [] as string[] };
      }

      const [evaluation] = await evaluateSupplierMatches(tx, quote, resolution.location, {
        supplierIds: [supplierCompanyId],
      });
      if (!evaluation) {
        return {
          outcome: "BLOCKED" as const,
          reasons: ["Company approval, membership, subscription, category or coverage is not currently eligible"],
        };
      }

      const selected = evaluation.outcome === "MATCHED";
      await tx.supplierMatchDecision.upsert({
        where: {
          quoteRequestId_supplierCompanyId: {
            quoteRequestId: quote.id,
            supplierCompanyId,
          },
        },
        create: {
          quoteRequestId: quote.id,
          supplierCompanyId,
          outcome: evaluation.outcome,
          score: evaluation.score,
          selected,
          reasons: evaluation.reasons,
          capabilitySnapshot: evaluation.capabilitySnapshot,
        },
        update: {
          outcome: evaluation.outcome,
          score: evaluation.score,
          selected,
          reasons: evaluation.reasons,
          capabilitySnapshot: evaluation.capabilitySnapshot,
          decidedAt: new Date(),
        },
      });

      if (!selected) return { outcome: "BLOCKED" as const, reasons: evaluation.reasons };

      const created = await tx.supplierAssignment.createMany({
        data: [{
          quoteRequestId: quote.id,
          supplierCompanyId,
          status: "PENDING",
          expiresAt: quote.responseDueAt,
          assignedById: null,
        }],
        skipDuplicates: true,
      });
      if (!created.count) return { outcome: "SKIPPED" as const, reasons: [] as string[] };

      const members = await tx.supplierTeamMembership.findMany({
        where: { supplierCompanyId, status: "ACTIVE" },
        select: { userId: true },
      });
      const disabledPreferences = await tx.notificationPreference.findMany({
        where: { supplierCompanyId, inAppEnabled: false },
        select: { userId: true },
      });
      const disabledUserIds = new Set(disabledPreferences.map((item) => item.userId));
      const recipients = members.filter((item) => !disabledUserIds.has(item.userId));
      if (recipients.length) {
        await tx.notification.createMany({
          data: recipients.map((member) => ({
            userId: member.userId,
            supplierCompanyId,
            type: "NEW_QUOTE_REQUEST" as const,
            channel: "IN_APP" as const,
            title: `New quote request ${quote.reference}`,
            body: `${quote.title} is available for review until the recorded response deadline.`,
            actionUrl: `/dashboard/requests/${quote.reference}`,
          })),
        });
      }
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
