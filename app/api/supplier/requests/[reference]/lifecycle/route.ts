import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireSupplierApi } from "@/lib/auth/api";
import { jobLifecycleSchema, validationError } from "@/lib/auth/validation";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { buyerRewardsConfig } from "@/lib/config";
import { allowedLifecycleTransitions, lifecycleStage, resolveBuyerExperience } from "@/lib/buyer/industry-experience";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const parsed = jobLifecycleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const { reference } = await params;
  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const located = await tx.quoteRequest.findUnique({ where: { reference }, select: { id: true } });
      if (!located) throw new Error("REQUEST_NOT_FOUND");
      await tx.$queryRaw`SELECT id FROM bridge_ai."QuoteRequest" WHERE id = ${located.id} FOR UPDATE`;
      const current = await tx.quoteRequest.findUnique({
        where: { id: located.id },
        include: {
          quotations: { where: { supplierCompanyId: auth.companyId, status: "ACCEPTED" }, select: { id: true } },
          buyerOrder: { select: { id: true, state: true, stageKey: true } },
          category: { include: { parent: { select: { buyerExperienceConfig: true } } } },
        },
      });
      if (!current || current.quotations.length !== 1 || !current.buyerOrder) throw new Error("SELECTED_QUOTATION_NOT_FOUND");
      const experience = resolveBuyerExperience(current.category);
      const target = lifecycleStage(experience, parsed.data.stageKey);
      const allowed = allowedLifecycleTransitions(experience, current.buyerOrder.stageKey);
      if (!allowed.some((stage) => stage.key === target.key)) throw new Error("INVALID_JOB_TRANSITION");
      if (target.state === "CANCELLED" && !parsed.data.reason) throw new Error("CANCELLATION_REASON_REQUIRED");
      // QuoteRequest retains only coarse platform outcomes for matching and
      // access control. The industry-defined stage lives on BuyerOrder. This
      // bridge deliberately preserves the coarse outcome for informational
      // stages such as ISSUE_REPORTED and supports any number of ACTIVE stages.
      let platformStatus = current.status;
      if (target.state === "ACTIVE" && ["SELECTED", "WON"].includes(platformStatus)) {
        const confirmed = await tx.quoteRequest.update({
          where: { id: current.id },
          data: { status: "CONFIRMED", confirmedAt: current.confirmedAt ?? now },
          select: { status: true },
        });
        platformStatus = confirmed.status;
      }
      if (target.state === "COMPLETED") {
        if (["SELECTED", "WON"].includes(platformStatus)) {
          const confirmed = await tx.quoteRequest.update({
            where: { id: current.id },
            data: { status: "CONFIRMED", confirmedAt: current.confirmedAt ?? now },
            select: { status: true },
          });
          platformStatus = confirmed.status;
        }
        const completed = await tx.quoteRequest.update({
          where: { id: current.id },
          data: { status: "COMPLETED", completedAt: now, closedAt: now },
          select: { status: true },
        });
        platformStatus = completed.status;
      }
      if (target.state === "CANCELLED") {
        const cancelled = await tx.quoteRequest.update({
          where: { id: current.id },
          data: { status: "CANCELLED_AFTER_SELECTION", cancelledAfterSelectionAt: now, closedAt: now },
          select: { status: true },
        });
        platformStatus = cancelled.status;
      }
      const order = await tx.buyerOrder.update({
        where: { quoteRequestId: current.id },
        data: {
          state: target.state,
          stageKey: target.key,
          nextAction: target.nextAction,
          confirmedAt: target.state === "ACTIVE" ? now : undefined,
          completedAt: target.state === "COMPLETED" ? now : undefined,
          cancelledAt: target.state === "CANCELLED" ? now : undefined,
          issueReportedAt: target.state === "ISSUE_REPORTED" ? now : undefined,
          events: {
            create: {
              state: target.state,
              stageKey: target.key,
              title: target.label,
              detail: parsed.data.reason ?? target.description,
              source: "SUPPLIER_PORTAL",
              actorAuthUserId: auth.session.userId,
            },
          },
        },
        select: { id: true },
      });
      if (target.state === "COMPLETED") {
        await tx.$executeRaw`SELECT bridge_private.credit_completed_buyer_order(${order.id}, ${buyerRewardsConfig().completionPoints})`;
      }
      await writeAuditLog({
        actorUserId: auth.session.userId,
        supplierCompanyId: auth.companyId,
        action: `BUYER_ORDER.STAGE.${target.key.toUpperCase()}`,
        entityType: "QuoteRequest",
        entityId: current.id,
        summary: `Buyer arrangement moved to ${target.label}`,
        metadata: { previousStageKey: current.buyerOrder.stageKey, nextStageKey: target.key, platformState: target.state, quotationId: current.quotations[0].id, buyerOrderId: order.id, reason: parsed.data.reason ?? null },
        request,
      }, tx);
      return { status: platformStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.includes("REQUEST_NOT_FOUND") || code.includes("SELECTED_QUOTATION_NOT_FOUND")) return NextResponse.json({ error: "Selected request not found" }, { status: 404 });
    if (code.includes("INVALID_JOB_TRANSITION")) return NextResponse.json({ error: "This arrangement has already moved to another stage. Refresh the page and try again." }, { status: 409 });
    if (code.includes("CANCELLATION_REASON_REQUIRED")) return NextResponse.json({ error: "Add a short reason before marking this as not proceeding." }, { status: 400 });
    console.error("Job lifecycle update failed", { reference, supplierCompanyId: auth.companyId, error });
    return NextResponse.json({ error: "The job stage could not be updated. Please try again." }, { status: 500 });
  }
}
