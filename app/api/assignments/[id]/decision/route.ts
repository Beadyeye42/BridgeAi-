import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession, getPrimarySupplierCompanyId } from "@/lib/auth/session";
import { assignmentDecisionSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.user.role !== "SUPPLIER") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const companyId = getPrimarySupplierCompanyId(session);
  if (!companyId) return NextResponse.json({ error: "No supplier company membership" }, { status: 403 });

  const parsed = assignmentDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const { id } = await params;
  const assignment = await prisma.supplierAssignment.findFirst({ where: { id, supplierCompanyId: companyId } });
  if (!assignment) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (!["PENDING", "VIEWED"].includes(assignment.status)) return NextResponse.json({ error: "This request has already been actioned" }, { status: 409 });

  const nextStatus = parsed.data.decision === "accept" ? "ACCEPTED" : "DECLINED";
  await prisma.$transaction(async (tx) => {
    await tx.supplierAssignment.update({ where: { id }, data: { status: nextStatus, respondedAt: new Date(), declinedReason: parsed.data.decision === "decline" ? parsed.data.reason : null } });
    await writeAuditLog({ actorUserId: session.userId, supplierCompanyId: companyId, action: `ASSIGNMENT.${nextStatus}`, entityType: "SupplierAssignment", entityId: id, summary: `Quote request ${nextStatus.toLowerCase()}`, request }, tx);
  });
  return NextResponse.json({ ok: true, status: nextStatus });
}
