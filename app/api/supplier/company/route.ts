import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { companyProfileSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { launchedSupplierCategoryWhere } from "@/lib/categories/catalogue";
import { lookupPostcode, normalizePostcode, PostcodeLookupError } from "@/lib/location/postcodes";
import { distanceMiles } from "@/lib/matching/coverage";
import { DEFAULT_PLAN_IDS, effectiveMembershipLimits } from "@/lib/billing/membership-plans";
import { isMembershipActive } from "@/lib/billing/pricing";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const parsed = companyProfileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const { categoryIds, ...profile } = parsed.data;
  const current = await prisma.supplierCompany.findUnique({
    where: { id: auth.companyId },
    include: {
      coverageAreas: { where: { active: true } },
      subscription: { include: { membershipPlan: true } },
    },
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

  const activeSubscription = isMembershipActive(current.subscription) ? current.subscription : null;
  const plan = activeSubscription?.membershipPlan
    ?? await prisma.membershipPlan.findUnique({ where: { id: DEFAULT_PLAN_IDS.LOCAL } });
  if (!plan) return NextResponse.json({ error: "Membership plans are not configured" }, { status: 503 });
  const limits = effectiveMembershipLimits(plan, current);
  for (const area of current.coverageAreas) {
    const purposeRadius = area.purpose === "SERVICE"
      ? limits.maximumServiceRadiusMiles
      : limits.maximumDeliveryRadiusMiles;
    if (area.type === "NATIONWIDE" && (!limits.nationwideAllowed || purposeRadius !== null)) {
      return NextResponse.json({ error: "Remove the existing nationwide coverage rule before changing the company postcode." }, { status: 409 });
    }
    if (area.type !== "DISTANCE" || purposeRadius === null) continue;
    if (area.latitude === null || area.longitude === null || area.radiusMiles === null) {
      return NextResponse.json({ error: "An existing coverage area needs to be removed and saved again before changing the company postcode." }, { status: 409 });
    }
    const offset = distanceMiles(companyBase, { latitude: Number(area.latitude), longitude: Number(area.longitude) });
    if (offset + area.radiusMiles > purposeRadius + 0.01) {
      return NextResponse.json({
        error: `Changing the company postcode would put ${area.label} outside your ${plan.name} boundary. Remove or reduce that coverage area first.`,
      }, { status: 409 });
    }
  }

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
    await writeAuditLog({ actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "SUPPLIER.PROFILE_UPDATED", entityType: "SupplierCompany", entityId: auth.companyId, summary: "Supplier company profile updated", request }, tx);
    return saved;
  });
  return NextResponse.json({ ok: true, company: { id: company.id, updatedAt: company.updatedAt } });
}
