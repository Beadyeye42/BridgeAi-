import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { supplierCapabilitiesSchema, supplierCapabilityActivationSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const membership = auth.session.user.memberships.find((item) => item.supplierCompanyId === auth.companyId);
  if (!membership || !["OWNER", "MANAGER"].includes(membership.role)) {
    return NextResponse.json({ error: "Only an owner or manager can activate supplier products" }, { status: 403 });
  }

  const parsed = supplierCapabilityActivationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });

  const selectedCategory = await prisma.supplierProductCategory.findFirst({
    where: {
      supplierCompanyId: auth.companyId,
      productCategoryId: parsed.data.productCategoryId,
    },
    select: { productCategory: { select: { name: true } } },
  });
  if (!selectedCategory) {
    return NextResponse.json({ error: "Select this product in Company profile before activating it" }, { status: 400 });
  }

  const confirmedAt = new Date();
  const capability = await prisma.$transaction(async (tx) => {
    const saved = await tx.supplierCapability.upsert({
      where: {
        supplierCompanyId_productCategoryId: {
          supplierCompanyId: auth.companyId,
          productCategoryId: parsed.data.productCategoryId,
        },
      },
      create: {
        supplierCompanyId: auth.companyId,
        productCategoryId: parsed.data.productCategoryId,
        active: true,
        capacityStatus: "AVAILABLE",
        standardLeadTimeDays: 14,
        deliveryDays: [1, 2, 3, 4, 5],
        lastConfirmedAt: confirmedAt,
      },
      update: {
        active: true,
        capacityStatus: "AVAILABLE",
        shortageNote: null,
        shortageUntil: null,
        lastConfirmedAt: confirmedAt,
      },
      select: {
        active: true,
        capacityStatus: true,
        lastConfirmedAt: true,
      },
    });
    await writeAuditLog({
      actorUserId: auth.session.userId,
      supplierCompanyId: auth.companyId,
      action: "SUPPLIER.CAPABILITY_ACTIVATED",
      entityType: "SupplierCapability",
      entityId: parsed.data.productCategoryId,
      summary: `${selectedCategory.productCategory.name} activated for quote matching`,
      metadata: {
        productCategoryId: parsed.data.productCategoryId,
        categoryName: selectedCategory.productCategory.name,
        capacityStatus: "AVAILABLE",
        confirmedAt: confirmedAt.toISOString(),
      },
      request,
    }, tx);
    return saved;
  });

  return NextResponse.json({ ok: true, capability });
}

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
