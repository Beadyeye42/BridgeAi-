import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { companyProfileSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { launchedSupplierCategoryWhere } from "@/lib/categories/catalogue";
import { lookupPostcode, normalizePostcode, PostcodeLookupError } from "@/lib/location/postcodes";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const parsed = companyProfileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const { categoryIds, ...profile } = parsed.data;
  const current = await prisma.supplierCompany.findUnique({
    where: { id: auth.companyId },
  });
  if (!current) return NextResponse.json({ error: "Supplier company not found" }, { status: 404 });

  let companyBase: { postcode: string; latitude: number; longitude: number };
  try {
    const currentPostcode = current.geographicOriginPostcode ?? current.postcode;
    const unchanged = currentPostcode
      && normalizePostcode(currentPostcode) === normalizePostcode(profile.postcode)
      && current.geographicOriginLatitude !== null
      && current.geographicOriginLongitude !== null;
    companyBase = unchanged
      ? {
        postcode: currentPostcode,
        latitude: Number(current.geographicOriginLatitude),
        longitude: Number(current.geographicOriginLongitude),
      }
      : await lookupPostcode(profile.postcode);
  } catch (error) {
    if (error instanceof PostcodeLookupError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "GEOCODING_UNAVAILABLE" ? 503 : 422 });
    }
    return NextResponse.json({ error: "The company postcode could not be validated" }, { status: 503 });
  }

  const geographicBaseChanged = normalizePostcode(current.geographicOriginPostcode ?? current.postcode ?? "")
    !== normalizePostcode(companyBase.postcode);

  const selectableCategories = await prisma.productCategory.findMany({ where: launchedSupplierCategoryWhere(), select: { id: true } });
  const selectableIds = selectableCategories.map((category) => category.id);
  const categoryCount = categoryIds.filter((id) => selectableIds.includes(id)).length;
  if (categoryCount !== categoryIds.length) return NextResponse.json({ error: "One or more product categories are unavailable" }, { status: 400 });
  const company = await prisma.$transaction(async (tx) => {
    const saved = await tx.supplierCompany.update({
      where: { id: auth.companyId },
      data: {
        ...profile,
        postcode: companyBase.postcode,
        geographicOriginPostcode: companyBase.postcode,
        geographicOriginLatitude: companyBase.latitude,
        geographicOriginLongitude: companyBase.longitude,
      },
    });
    await tx.supplierProductCategory.deleteMany({
      where: {
        supplierCompanyId: auth.companyId,
        productCategoryId: { in: selectableIds, notIn: categoryIds },
      },
    });
    await tx.supplierCapability.deleteMany({
      where: {
        supplierCompanyId: auth.companyId,
        productCategoryId: { in: selectableIds, notIn: categoryIds },
      },
    });
    await tx.supplierProductCategory.createMany({ data: categoryIds.map((productCategoryId) => ({ supplierCompanyId: auth.companyId, productCategoryId })), skipDuplicates: true });
    await tx.supplierCapability.createMany({
      data: categoryIds.map((productCategoryId) => ({
        supplierCompanyId: auth.companyId,
        productCategoryId,
        standardLeadTimeDays: 14,
        capacityStatus: "PAUSED" as const,
        active: false,
      })),
      skipDuplicates: true,
    });
    await writeAuditLog({ actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "SUPPLIER.PROFILE_UPDATED", entityType: "SupplierCompany", entityId: auth.companyId, summary: "Supplier company profile updated", metadata: { geographicBaseChanged }, request }, tx);
    return saved;
  });
  return NextResponse.json({
    ok: true,
    company: { id: company.id, updatedAt: company.updatedAt },
    geographicBaseChanged,
    geographyReconciled: geographicBaseChanged,
  });
}
