import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { adminSupplierStatusSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { supplierApprovalReadiness } from "@/lib/suppliers/onboarding";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsed = adminSupplierStatusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  if (parsed.data.status === "SUSPENDED" && !parsed.data.note) {
    return NextResponse.json({ error: "Provide a suspension reason" }, { status: 400 });
  }
  const { id } = await params;
  const existing = await prisma.supplierCompany.findUnique({
    where: { id },
    include: {
      categories: true,
      coverageAreas: true,
      memberships: true,
    },
  });
  if (!existing) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });

  const readiness = supplierApprovalReadiness(existing);
  if (parsed.data.status === "APPROVED" && !readiness.ready) {
    return NextResponse.json({
      error: `Supplier is not ready for approval: ${readiness.blockers.join(", ")}.`,
      blockers: readiness.blockers,
    }, { status: 409 });
  }

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.supplierCompany.update({
        where: { id },
        data: {
          status: parsed.data.status,
          approvedAt: parsed.data.status === "APPROVED" ? now : existing.approvedAt,
          approvedById: parsed.data.status === "APPROVED" ? auth.session.userId : existing.approvedById,
          suspendedAt: parsed.data.status === "SUSPENDED" ? now : null,
          suspensionNote: parsed.data.status === "SUSPENDED" ? parsed.data.note : null,
        },
      });
      await writeAuditLog({
        actorUserId: auth.session.userId,
        supplierCompanyId: id,
        action: `ADMIN.SUPPLIER_${parsed.data.status}`,
        entityType: "SupplierCompany",
        entityId: id,
        summary: `Supplier status changed from ${existing.status} to ${parsed.data.status}`,
        metadata: { note: parsed.data.note ?? null, readiness: readiness.items.map((item) => ({ key: item.key, complete: item.complete })) },
        request,
      }, tx);
    });
  } catch (error) {
    if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2004")
      || (error instanceof Error && error.message.includes("supplier approval requirements are incomplete"))) {
      return NextResponse.json({ error: "Supplier approval requirements changed. Refresh and review the checklist again." }, { status: 409 });
    }
    throw error;
  }
  return NextResponse.json({ ok: true, status: parsed.data.status });
}
