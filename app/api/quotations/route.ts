import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession, getPrimarySupplierCompanyId } from "@/lib/auth/session";
import { quotationSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session || session.user.role !== "SUPPLIER") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const companyId = getPrimarySupplierCompanyId(session);
  if (!companyId) return NextResponse.json({ error: "No supplier company membership" }, { status: 403 });
  const parsed = quotationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });

  const assignment = await prisma.supplierAssignment.findFirst({ where: { id: parsed.data.assignmentId, supplierCompanyId: companyId, status: "ACCEPTED", expiresAt: { gt: new Date() } } });
  if (!assignment) return NextResponse.json({ error: "Accepted request not found or response window has closed" }, { status: 404 });
  const subscription = await prisma.subscription.findUnique({ where: { supplierCompanyId: companyId } });
  if (!subscription || subscription.status !== "ACTIVE" || (subscription.currentPeriodEnd && subscription.currentPeriodEnd <= new Date())) return NextResponse.json({ error: "An active £5 monthly membership is required before submitting a quotation" }, { status: 402 });

  const quotation = await prisma.$transaction(async (tx) => {
    const saved = await tx.supplierQuotation.upsert({
      where: { assignmentId: assignment.id },
      update: { price: parsed.data.price, leadTimeDays: parsed.data.leadTimeDays, validUntil: parsed.data.validUntil, notes: parsed.data.notes, status: "SUBMITTED", submittedAt: new Date() },
      create: { quoteRequestId: assignment.quoteRequestId, supplierCompanyId: companyId, assignmentId: assignment.id, price: parsed.data.price, leadTimeDays: parsed.data.leadTimeDays, validUntil: parsed.data.validUntil, notes: parsed.data.notes, status: "SUBMITTED", submittedAt: new Date() },
    });
    await tx.supplierAssignment.update({ where: { id: assignment.id }, data: { status: "QUOTED", respondedAt: new Date() } });
    await writeAuditLog({ actorUserId: session.userId, supplierCompanyId: companyId, action: "QUOTATION.SUBMITTED", entityType: "SupplierQuotation", entityId: saved.id, summary: "Supplier quotation submitted", metadata: { price: parsed.data.price, leadTimeDays: parsed.data.leadTimeDays }, request }, tx);
    return saved;
  });
  return NextResponse.json({ ok: true, quotationId: quotation.id }, { status: 201 });
}
