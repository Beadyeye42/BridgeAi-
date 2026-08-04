import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { accreditationReviewSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsed = accreditationReviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const { id } = await params;
  const accreditation = await prisma.supplierAccreditation.findUnique({
    where: { id },
    include: { attachment: true },
  });
  if (!accreditation) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  if (accreditation.status !== "PENDING") return NextResponse.json({ error: "This document has already been reviewed" }, { status: 409 });
  if (parsed.data.status === "APPROVED" && accreditation.attachment.scanStatus !== "CLEAN") {
    return NextResponse.json({ error: "The security scan must pass before approval" }, { status: 409 });
  }
  if (parsed.data.status === "APPROVED" && accreditation.expiresAt && accreditation.expiresAt <= new Date()) {
    return NextResponse.json({ error: "An expired document cannot be approved" }, { status: 409 });
  }

  const reviewed = await prisma.$transaction(async (tx) => {
    const saved = await tx.supplierAccreditation.update({
      where: { id },
      data: {
        status: parsed.data.status,
        reviewNote: parsed.data.note || null,
        reviewedAt: new Date(),
        reviewedById: auth.session.userId,
      },
    });
    await writeAuditLog({
      actorUserId: auth.session.userId,
      supplierCompanyId: accreditation.supplierCompanyId,
      action: `ADMIN.ACCREDITATION_${parsed.data.status}`,
      entityType: "SupplierAccreditation",
      entityId: id,
      summary: `Supplier accreditation ${parsed.data.status.toLowerCase()}`,
      metadata: { note: parsed.data.note || null },
      request,
    }, tx);
    return saved;
  });
  return NextResponse.json({ ok: true, status: reviewed.status });
}
