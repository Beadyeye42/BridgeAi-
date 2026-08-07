import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { writeAuditLog } from "@/lib/audit";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const existing = await prisma.collectionLocation.findFirst({ where: { id, supplierCompanyId: auth.companyId } });
  if (!existing) return NextResponse.json({ error: "Collection location not found" }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await tx.collectionLocation.delete({ where: { id } });
    await writeAuditLog({
      actorUserId: auth.session.userId,
      supplierCompanyId: auth.companyId,
      action: "COLLECTION_LOCATION.DELETED",
      entityType: "CollectionLocation",
      entityId: id,
      summary: `Collection location ${existing.label} deleted`,
      request,
    }, tx);
  });
  return NextResponse.json({ ok: true });
}
