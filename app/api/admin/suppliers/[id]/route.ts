import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { adminSupplierEditSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { lookupPostcode, normalizePostcode, PostcodeLookupError } from "@/lib/location/postcodes";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsed = adminSupplierEditSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const { id } = await params;
  const existing = await prisma.supplierCompany.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });

  let companyBase: { postcode: string; latitude: number; longitude: number };
  try {
    const currentPostcode = existing.geographicOriginPostcode ?? existing.postcode;
    const unchanged = currentPostcode
      && normalizePostcode(currentPostcode) === normalizePostcode(parsed.data.postcode)
      && existing.geographicOriginLatitude !== null
      && existing.geographicOriginLongitude !== null;
    companyBase = unchanged
      ? {
        postcode: currentPostcode,
        latitude: Number(existing.geographicOriginLatitude),
        longitude: Number(existing.geographicOriginLongitude),
      }
      : await lookupPostcode(parsed.data.postcode);
  } catch (error) {
    if (error instanceof PostcodeLookupError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "GEOCODING_UNAVAILABLE" ? 503 : 422 });
    }
    return NextResponse.json({ error: "The company postcode could not be validated" }, { status: 503 });
  }

  const geographicBaseChanged = normalizePostcode(existing.geographicOriginPostcode ?? existing.postcode ?? "")
    !== normalizePostcode(companyBase.postcode);
  await prisma.$transaction(async (tx) => {
    await tx.supplierCompany.update({
      where: { id },
      data: {
        ...parsed.data,
        postcode: companyBase.postcode,
        geographicOriginPostcode: companyBase.postcode,
        geographicOriginLatitude: companyBase.latitude,
        geographicOriginLongitude: companyBase.longitude,
      },
    });
    await writeAuditLog({
      actorUserId: auth.session.userId,
      supplierCompanyId: id,
      action: "ADMIN.SUPPLIER_EDITED",
      entityType: "SupplierCompany",
      entityId: id,
      summary: "Administrator edited supplier company details",
      metadata: { geographicBaseChanged },
      request,
    }, tx);
  });
  return NextResponse.json({ ok: true, geographicBaseChanged, geographyReconciled: geographicBaseChanged });
}
