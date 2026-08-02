import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { writeAuditLog } from "@/lib/audit";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSupplierApi(); if ("error" in auth) return auth.error;
  const { id } = await params;
  const existing = await prisma.coverageArea.findFirst({ where: { id, supplierCompanyId: auth.companyId } });
  if (!existing) return NextResponse.json({ error: "Coverage area not found" }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await tx.coverageArea.delete({ where: { id } });
    await writeAuditLog({ actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "COVERAGE.DELETED", entityType: "CoverageArea", entityId: id, summary: `Coverage area ${existing.label} deleted`, request }, tx);
  });
  return NextResponse.json({ ok: true });
}
