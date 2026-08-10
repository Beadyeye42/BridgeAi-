import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession, getPrimarySupplierCompanyId } from "@/lib/auth/session";
import { assignmentDecisionSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { inviteNextEligibleSupplier } from "@/lib/matching/replacements";
import { processSupplierEmailsSafely } from "@/lib/notifications/email-worker";
import { isMembershipActive } from "@/lib/billing/pricing";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.user.role !== "SUPPLIER") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const companyId = getPrimarySupplierCompanyId(session);
  if (!companyId) return NextResponse.json({ error: "No supplier company membership" }, { status: 403 });

  const subscription = await prisma.subscription.findUnique({ where: { supplierCompanyId: companyId } });
  if (!isMembershipActive(subscription)) {
    return NextResponse.json({
      error: "Your Bridge AI membership is not active. Renew your membership to respond to quote opportunities.",
      code: "MEMBERSHIP_REQUIRED",
      actionUrl: "/dashboard/subscription",
    }, { status: 402 });
  }

  const parsed = assignmentDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const { id } = await params;
  const assignment = await prisma.supplierAssignment.findFirst({
    where: { id, supplierCompanyId: companyId },
    include: { quoteRequest: { select: { status: true, responseDueAt: true } } },
  });
  if (!assignment) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (!["PENDING", "VIEWED"].includes(assignment.status)) return NextResponse.json({ error: "This request has already been actioned" }, { status: 409 });
  if (assignment.expiresAt <= new Date()) return NextResponse.json({ error: "The response window has closed" }, { status: 410 });
  if (!["OPEN", "MATCHING", "QUOTED"].includes(assignment.quoteRequest.status) || assignment.quoteRequest.responseDueAt <= new Date()) {
    return NextResponse.json({ error: "This request has closed" }, { status: 409 });
  }

  const nextStatus = parsed.data.decision === "accept" ? "ACCEPTED" : "DECLINED";
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bridge_ai."QuoteRequest" WHERE id = ${assignment.quoteRequestId} FOR UPDATE`;
      const current = await tx.supplierAssignment.findFirst({
        where: { id, supplierCompanyId: companyId },
        include: { quoteRequest: { select: { status: true, responseDueAt: true } } },
      });
      const now = new Date();
      if (!current || !["PENDING", "VIEWED"].includes(current.status) || current.expiresAt <= now) throw new Error("ASSIGNMENT_CLOSED");
      if (!["OPEN", "MATCHING", "QUOTED"].includes(current.quoteRequest.status) || current.quoteRequest.responseDueAt <= now) throw new Error("REQUEST_CLOSED");
      await tx.supplierAssignment.update({ where: { id }, data: { status: nextStatus, respondedAt: now, declinedReason: parsed.data.decision === "decline" ? parsed.data.reason : null } });
      await writeAuditLog({ actorUserId: session.userId, supplierCompanyId: companyId, action: `ASSIGNMENT.${nextStatus}`, entityType: "SupplierAssignment", entityId: id, summary: `Quote request ${nextStatus.toLowerCase()}`, request }, tx);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("REQUEST_CLOSED") || message.includes("ASSIGNMENT_CLOSED")) {
      return NextResponse.json({ error: "This request has closed" }, { status: 409 });
    }
    throw error;
  }
  if (nextStatus === "DECLINED") {
    await inviteNextEligibleSupplier(assignment.quoteRequestId, assignment.id).catch((error) => console.error("Automatic replacement invitation failed", error));
    after(() => processSupplierEmailsSafely({ limit: 10 }));
  }
  return NextResponse.json({ ok: true, status: nextStatus });
}
