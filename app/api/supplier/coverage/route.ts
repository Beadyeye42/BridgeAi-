import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { coverageAreaSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { lookupPostcode, PostcodeLookupError } from "@/lib/location/postcodes";

export async function POST(request: Request) {
  const auth = await requireSupplierApi(); if ("error" in auth) return auth.error;
  const parsed = coverageAreaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });

  let data: Prisma.CoverageAreaUncheckedCreateInput;
  try {
    if (parsed.data.type === "DISTANCE") {
      const location = await lookupPostcode(parsed.data.centrePostcode);
      data = {
        supplierCompanyId: auth.companyId,
        type: parsed.data.type,
        label: parsed.data.label ?? `${location.postcode} base`,
        centrePostcode: location.postcode,
        radiusMiles: parsed.data.radiusMiles,
        latitude: location.latitude,
        longitude: location.longitude,
      };
    } else if (parsed.data.type === "POSTCODE") {
      data = { supplierCompanyId: auth.companyId, ...parsed.data, label: parsed.data.label ?? `${parsed.data.postcodePrefix} area` };
    } else {
      data = { supplierCompanyId: auth.companyId, type: parsed.data.type, label: parsed.data.label ?? "Nationwide" };
    }
  } catch (error) {
    if (error instanceof PostcodeLookupError) {
      const status = error.code === "GEOCODING_UNAVAILABLE" ? 503 : 422;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "The coverage location could not be validated" }, { status: 503 });
  }

  try {
    const area = await prisma.$transaction(async (tx) => {
      const saved = await tx.coverageArea.create({ data });
      await writeAuditLog({ actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "COVERAGE.CREATED", entityType: "CoverageArea", entityId: saved.id, summary: `Coverage area ${saved.label} created`, metadata: { type: saved.type, radiusMiles: saved.radiusMiles }, request }, tx);
      return saved;
    });
    return NextResponse.json({ ok: true, area }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && parsed.data.type === "NATIONWIDE") {
      return NextResponse.json({ error: "An active nationwide coverage rule already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "The coverage area could not be saved" }, { status: 409 });
  }
}
