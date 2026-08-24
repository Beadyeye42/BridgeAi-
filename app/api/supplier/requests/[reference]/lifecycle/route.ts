import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireSupplierApi } from "@/lib/auth/api";
import { jobLifecycleSchema, validationError } from "@/lib/auth/validation";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { buyerRewardsConfig } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const parsed = jobLifecycleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const { reference } = await params;
  const now = new Date();
  const nextStatus = parsed.data.action === "confirm" ? "CONFIRMED" : parsed.data.action === "complete" ? "COMPLETED" : "CANCELLED_AFTER_SELECTION";
  const cancellationReason = parsed.data.action === "cancel" ? parsed.data.reason : undefined;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const located = await tx.quoteRequest.findUnique({ where: { reference }, select: { id: true } });
      if (!located) throw new Error("REQUEST_NOT_FOUND");
      await tx.$queryRaw`SELECT id FROM bridge_ai."QuoteRequest" WHERE id = ${located.id} FOR UPDATE`;
      const current = await tx.quoteRequest.findUnique({
        where: { id: located.id },
        include: { quotations: { where: { supplierCompanyId: auth.companyId, status: "ACCEPTED" }, select: { id: true } } },
      });
      if (!current || current.quotations.length !== 1) throw new Error("SELECTED_QUOTATION_NOT_FOUND");
      const currentStatus = current.status === "WON" ? "SELECTED" : current.status;
      const allowed = parsed.data.action === "confirm"
        ? currentStatus === "SELECTED"
        : parsed.data.action === "complete"
          ? currentStatus === "CONFIRMED"
          : ["SELECTED", "CONFIRMED"].includes(currentStatus);
      if (!allowed) throw new Error("INVALID_JOB_TRANSITION");
      const saved = await tx.quoteRequest.update({
        where: { id: current.id },
        data: {
          status: nextStatus,
          confirmedAt: nextStatus === "CONFIRMED" ? now : undefined,
          completedAt: nextStatus === "COMPLETED" ? now : undefined,
          cancelledAfterSelectionAt: nextStatus === "CANCELLED_AFTER_SELECTION" ? now : undefined,
          closedAt: ["COMPLETED", "CANCELLED_AFTER_SELECTION"].includes(nextStatus) ? now : undefined,
        },
      });
      const orderStatus = nextStatus === "CANCELLED_AFTER_SELECTION" ? "CANCELLED" : nextStatus;
      const order = await tx.buyerOrder.update({
        where: { quoteRequestId: current.id },
        data: {
          status: orderStatus,
          confirmedAt: orderStatus === "CONFIRMED" ? now : undefined,
          completedAt: orderStatus === "COMPLETED" ? now : undefined,
          cancelledAt: orderStatus === "CANCELLED" ? now : undefined,
          events: {
            create: {
              status: orderStatus,
              title: orderStatus === "CONFIRMED" ? "Order confirmed" : orderStatus === "COMPLETED" ? "Order completed" : "Order cancelled",
              detail: orderStatus === "CANCELLED" ? cancellationReason : undefined,
              source: "SUPPLIER_PORTAL",
              actorAuthUserId: auth.session.userId,
            },
          },
        },
        select: { id: true },
      });
      if (orderStatus === "COMPLETED") {
        await tx.$executeRaw`SELECT bridge_private.credit_completed_buyer_order(${order.id}, ${buyerRewardsConfig().completionPoints})`;
      }
      await writeAuditLog({
        actorUserId: auth.session.userId,
        supplierCompanyId: auth.companyId,
        action: `JOB.${nextStatus}`,
        entityType: "QuoteRequest",
        entityId: current.id,
        summary: nextStatus === "CANCELLED_AFTER_SELECTION" ? "Selected job recorded as not proceeding" : `Selected job marked ${nextStatus.toLowerCase()}`,
        metadata: { previousStatus: current.status, nextStatus, quotationId: current.quotations[0].id, buyerOrderId: order.id, reason: cancellationReason ?? null },
        request,
      }, tx);
      return saved;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.includes("REQUEST_NOT_FOUND") || code.includes("SELECTED_QUOTATION_NOT_FOUND")) return NextResponse.json({ error: "Selected request not found" }, { status: 404 });
    if (code.includes("INVALID_JOB_TRANSITION")) return NextResponse.json({ error: "This job has already moved to another stage. Refresh the page and try again." }, { status: 409 });
    console.error("Job lifecycle update failed", { reference, supplierCompanyId: auth.companyId, error });
    return NextResponse.json({ error: "The job stage could not be updated. Please try again." }, { status: 500 });
  }
}
