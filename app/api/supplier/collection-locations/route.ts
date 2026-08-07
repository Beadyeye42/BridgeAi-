import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { collectionLocationSchema, validationError } from "@/lib/auth/validation";
import { lookupPostcode, PostcodeLookupError } from "@/lib/location/postcodes";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const parsed = collectionLocationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });

  try {
    const location = await lookupPostcode(parsed.data.postcode);
    const saved = await prisma.$transaction(async (tx) => {
      const result = await tx.collectionLocation.create({
        data: {
          supplierCompanyId: auth.companyId,
          label: parsed.data.label,
          postcode: location.postcode,
          latitude: location.latitude,
          longitude: location.longitude,
          collectionDays: parsed.data.collectionDays,
          noticeRequired: parsed.data.noticeRequired,
          noticeHours: parsed.data.noticeRequired ? parsed.data.noticeHours : null,
        },
      });
      await writeAuditLog({
        actorUserId: auth.session.userId,
        supplierCompanyId: auth.companyId,
        action: "COLLECTION_LOCATION.CREATED",
        entityType: "CollectionLocation",
        entityId: result.id,
        summary: `Collection location ${result.label} created`,
        metadata: { postcode: result.postcode, collectionDays: result.collectionDays },
        request,
      }, tx);
      return result;
    });
    return NextResponse.json({ ok: true, location: saved }, { status: 201 });
  } catch (error) {
    if (error instanceof PostcodeLookupError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "GEOCODING_UNAVAILABLE" ? 503 : 422 });
    }
    return NextResponse.json({ error: "The collection location could not be saved" }, { status: 409 });
  }
}
