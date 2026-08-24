import { after, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { adminAssignmentSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { evaluateSupplierMatches, resolveDeliveryLocation } from "@/lib/matching/suppliers";
import { lockSupplierAssignmentScope, recordMatchingEvaluation } from "@/lib/matching/distribution";
import { queueSupplierAssignmentNotifications } from "@/lib/notifications/assignment-notifications";
import { processSupplierEmailsSafely } from "@/lib/notifications/email-worker";
import { addSupplierResponseHours } from "@/lib/quotes/response-clock";
import { resolveIndustryResponseDeadlines } from "@/lib/matching/deadlines";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsed = adminAssignmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });

  const preflight = await prisma.quoteRequest.findUnique({ where: { id: parsed.data.quoteRequestId } });
  if (!preflight) return NextResponse.json({ error: "Quote request not found" }, { status: 404 });
  const resolution = await resolveDeliveryLocation(preflight);

  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bridge_ai."QuoteRequest" WHERE id = ${parsed.data.quoteRequestId} FOR UPDATE`;
      let quote = await tx.quoteRequest.findUnique({ where: { id: parsed.data.quoteRequestId }, include: { items: true } });
      if (!quote) throw new Error("REQUEST_NOT_FOUND");
      if (quote.deliveryPostcode !== preflight.deliveryPostcode) throw new Error("REQUEST_CHANGED");
      if (!["OPEN", "MATCHING"].includes(quote.status)) throw new Error("REQUEST_NOT_OPEN");
      if (quote.responseDueAt <= new Date()) throw new Error("RESPONSE_WINDOW_CLOSED");
      if ((quote.matchingLatitude === null || quote.matchingLongitude === null)
        && resolution.location.latitude !== null && resolution.location.longitude !== null) {
        quote = await tx.quoteRequest.update({
          where: { id: quote.id },
          data: {
            matchingPostcode: resolution.location.postcode,
            matchingLatitude: resolution.location.latitude,
            matchingLongitude: resolution.location.longitude,
          },
          include: { items: true },
        });
      }

      const current = await tx.supplierAssignment.count({ where: { quoteRequestId: quote.id, status: { notIn: ["WITHDRAWN"] } } });
      const matchingConfiguration = await tx.matchingConfiguration.findUnique({ where: { id: "default" } });
      const deadlines = await resolveIndustryResponseDeadlines(tx, quote.categoryId, {
        acknowledgementHours: matchingConfiguration?.acknowledgementDeadlineHours ?? matchingConfiguration?.responseDeadlineHours ?? 8,
        quotationHours: matchingConfiguration?.quotationDeadlineHours ?? matchingConfiguration?.responseDeadlineHours ?? 24,
      });
      const acknowledgementDueAt = addSupplierResponseHours(new Date(), deadlines.acknowledgementHours);
      const unique = [...new Set(parsed.data.supplierCompanyIds)];
      if (current + unique.length > quote.distributionLimit || current + unique.length > 5) throw new Error("DISTRIBUTION_LIMIT");

      const evaluations = await evaluateSupplierMatches(tx, quote, resolution.location, {
        capacityOverrideSupplierIds: parsed.data.capacityOverrideSupplierIds,
      });
      const matches = evaluations.filter((evaluation) => unique.includes(evaluation.id) && evaluation.outcome === "MATCHED");
      if (matches.length !== unique.length) throw new Error("INELIGIBLE_SUPPLIER");

      await recordMatchingEvaluation(tx, {
        quoteRequestId: quote.id,
        categoryId: quote.categoryId,
        deliveryPostcode: quote.deliveryPostcode,
        matchingPostcode: quote.matchingPostcode ?? quote.deliveryPostcode,
        evaluations,
        selectedSupplierIds: unique,
        invitedSupplierCount: current + unique.length,
        preserveExistingSelections: true,
      });
      await lockSupplierAssignmentScope(tx, unique);

      const result = await tx.supplierAssignment.createMany({
        data: unique.map((supplierCompanyId) => ({
          quoteRequestId: quote.id,
          supplierCompanyId,
          status: "PENDING",
          expiresAt: quote.responseDueAt,
          assignedById: auth.session.userId,
          marketDensityMode: matches.find((match) => match.id === supplierCompanyId)?.marketDensityMode,
          softCapOverride: matches.find((match) => match.id === supplierCompanyId)?.softCapOverride ?? false,
          capacityOverride: parsed.data.capacityOverrideSupplierIds.includes(supplierCompanyId),
        })),
        skipDuplicates: true,
      });
      await tx.quoteRequest.update({ where: { id: quote.id }, data: { status: "MATCHING" } });
      await queueSupplierAssignmentNotifications(tx, {
        supplierCompanyIds: unique,
        reference: quote.reference,
        title: quote.title,
        responseDueAt: quote.responseDueAt,
      });
      await writeAuditLog({
        actorUserId: auth.session.userId,
        action: "ADMIN.REQUEST_ASSIGNED",
        entityType: "QuoteRequest",
        entityId: quote.id,
        summary: `Request assigned to ${result.count} supplier(s)`,
        metadata: {
          supplierCompanyIds: unique,
          capabilityMatches: matches.map((match) => ({ supplierCompanyId: match.id, score: match.score, reasons: match.reasons })),
          distributionLimit: quote.distributionLimit,
          responseDueAt: quote.responseDueAt.toISOString(),
          acknowledgementDueAt: acknowledgementDueAt.toISOString(),
        },
        request,
      }, tx);
      return result.count;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });
    after(() => processSupplierEmailsSafely({ limit: 25 }));
    return NextResponse.json({ ok: true, created }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const messages: Record<string, [string, number]> = {
      REQUEST_NOT_FOUND: ["Quote request not found", 404],
      REQUEST_CHANGED: ["The delivery details changed while matching. Retry the assignment.", 409],
      REQUEST_NOT_OPEN: ["Only open requests can be assigned", 409],
      RESPONSE_WINDOW_CLOSED: ["The supplier response window has closed", 409],
      DISTRIBUTION_LIMIT: ["This assignment would exceed the five-supplier request limit", 409],
      INELIGIBLE_SUPPLIER: ["Every selected supplier must pass the current capability, capacity, subscription, category and coverage checks", 400],
    };
    const known = messages[code];
    if (known) return NextResponse.json({ error: known[0] }, { status: known[1] });
    return NextResponse.json({ error: "The assignments could not be created. Retry the operation." }, { status: 409 });
  }
}
