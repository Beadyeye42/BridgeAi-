import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { supplierCapabilitiesSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const membership = auth.session.user.memberships.find((item) => item.supplierCompanyId === auth.companyId);
  if (!membership || !["OWNER", "MANAGER"].includes(membership.role)) {
    return NextResponse.json({ error: "Only an owner or manager can update supplier capabilities" }, { status: 403 });
  }
  const parsed = supplierCapabilitiesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });

  const selected = await prisma.supplierProductCategory.findMany({
    where: { supplierCompanyId: auth.companyId },
    select: { productCategoryId: true },
  });
  const selectedIds = new Set(selected.map((item) => item.productCategoryId));
  if (parsed.data.capabilities.some((item) => !selectedIds.has(item.productCategoryId))) {
    return NextResponse.json({ error: "A capability can only be saved for a selected product category" }, { status: 400 });
  }

  const confirmedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.supplierCapability.deleteMany({
      where: { supplierCompanyId: auth.companyId, productCategoryId: { notIn: [...selectedIds] } },
    });
    for (const capability of parsed.data.capabilities) {
      const data = {
        ...capability,
        minimumOrderValue: capability.minimumOrderValue,
        shortageUntil: capability.shortageUntil ? new Date(capability.shortageUntil) : null,
        lastConfirmedAt: confirmedAt,
      };
      await tx.supplierCapability.upsert({
        where: { supplierCompanyId_productCategoryId: { supplierCompanyId: auth.companyId, productCategoryId: capability.productCategoryId } },
        create: { supplierCompanyId: auth.companyId, ...data },
        update: data,
      });
    }
    await writeAuditLog({
      actorUserId: auth.session.userId,
      supplierCompanyId: auth.companyId,
      action: "SUPPLIER.CAPABILITIES_CONFIRMED",
      entityType: "SupplierCapability",
      entityId: auth.companyId,
      summary: `Supplier confirmed ${parsed.data.capabilities.length} capability record(s)`,
      metadata: {
        categoryIds: parsed.data.capabilities.map((item) => item.productCategoryId),
        capacityStatuses: parsed.data.capabilities.map((item) => ({ categoryId: item.productCategoryId, status: item.capacityStatus })),
        confirmedAt: confirmedAt.toISOString(),
      },
      request,
    }, tx);
  });
  return NextResponse.json({ ok: true, confirmedAt: confirmedAt.toISOString() });
}
