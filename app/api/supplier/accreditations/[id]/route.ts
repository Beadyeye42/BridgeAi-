import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { getPrivateStorage, PRIVATE_BUCKET } from "@/lib/storage";
import { writeAuditLog } from "@/lib/audit";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const membership = auth.session.user.memberships.find((item) => item.supplierCompanyId === auth.companyId);
  if (!membership || !["OWNER", "MANAGER"].includes(membership.role)) {
    return NextResponse.json({ error: "Owner or manager access required" }, { status: 403 });
  }
  const { id } = await params;
  const accreditation = await prisma.supplierAccreditation.findFirst({
    where: { id, supplierCompanyId: auth.companyId },
    include: { attachment: true },
  });
  if (!accreditation) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  if (!["PENDING", "REJECTED"].includes(accreditation.status)) {
    return NextResponse.json({ error: "Approved documents cannot be removed; contact Bridge AI support" }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id: accreditation.attachmentId } });
    await writeAuditLog({
      actorUserId: auth.session.userId,
      supplierCompanyId: auth.companyId,
      action: "ACCREDITATION.DELETED",
      entityType: "SupplierAccreditation",
      entityId: accreditation.id,
      summary: "Supplier accreditation document removed",
      metadata: { previousStatus: accreditation.status },
      request,
    }, tx);
  });

  const removed = await (await getPrivateStorage()).storage.from(PRIVATE_BUCKET).remove([accreditation.attachment.storageKey]);
  if (removed.error) console.error("Accreditation storage cleanup failed", removed.error);
  return NextResponse.json({ ok: true });
}
