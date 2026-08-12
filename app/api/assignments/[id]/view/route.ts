import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { writeAuditLog } from "@/lib/audit";
import { hasCurrentGeographicOpportunityAccess } from "@/lib/billing/opportunity-access";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const company = await prisma.supplierCompany.findUnique({
    where: { id: auth.companyId },
    include: { subscription: { include: { membershipPlan: true } } },
  });
  if (!company) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  const assignment = await prisma.supplierAssignment.findFirst({
    where: { id, supplierCompanyId: auth.companyId },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      quoteRequest: { select: { deliveryLatitude: true, deliveryLongitude: true, fulfilmentMode: true } },
    },
  });
  if (!assignment) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (!hasCurrentGeographicOpportunityAccess(company, assignment.quoteRequest)) {
    return NextResponse.json({ error: "This request is outside your current membership area" }, { status: 403 });
  }
  if (assignment.status !== "PENDING") return NextResponse.json({ ok: true, status: assignment.status });
  if (assignment.expiresAt <= new Date()) return NextResponse.json({ ok: true, status: "EXPIRED" });

  const viewedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.supplierAssignment.updateMany({
      where: { id, supplierCompanyId: auth.companyId, status: "PENDING", expiresAt: { gt: viewedAt } },
      data: { status: "VIEWED", viewedAt },
    });
    if (updated.count) {
      await writeAuditLog({
        actorUserId: auth.session.userId,
        supplierCompanyId: auth.companyId,
        action: "ASSIGNMENT.VIEWED",
        entityType: "SupplierAssignment",
        entityId: id,
        summary: "Supplier opened quote request",
        request,
      }, tx);
    }
  });
  return NextResponse.json({ ok: true, status: "VIEWED" });
}
