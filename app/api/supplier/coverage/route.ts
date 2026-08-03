import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { coverageAreaSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { lookupPostcode, normalizePostcode, postcodeOutwardCode, PostcodeLookupError } from "@/lib/location/postcodes";

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
      const suppliedPostcode = normalizePostcode(parsed.data.postcodePrefix);
      const postcodePrefix = suppliedPostcode.length > 4
        ? postcodeOutwardCode((await lookupPostcode(suppliedPostcode)).postcode)
        : suppliedPostcode;
      data = { supplierCompanyId: auth.companyId, type: parsed.data.type, postcodePrefix, label: parsed.data.label ?? `${postcodePrefix} area` };
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
    const result = await prisma.$transaction(async (tx) => {
      const duplicateWhere: Prisma.CoverageAreaWhereInput = {
        supplierCompanyId: auth.companyId,
        type: data.type,
        active: true,
        ...(data.type === "DISTANCE" ? { centrePostcode: data.centrePostcode, radiusMiles: data.radiusMiles }
          : data.type === "POSTCODE" ? { postcodePrefix: data.postcodePrefix }
          : {}),
      };
      const existing = await tx.coverageArea.findFirst({ where: duplicateWhere });
      if (existing) return { area: existing, alreadyExists: true };

      const saved = await tx.coverageArea.create({ data });
      await writeAuditLog({ actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "COVERAGE.CREATED", entityType: "CoverageArea", entityId: saved.id, summary: `Coverage area ${saved.label} created`, metadata: { type: saved.type, radiusMiles: saved.radiusMiles }, request }, tx);
      return { area: saved, alreadyExists: false };
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.alreadyExists ? 200 : 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && parsed.data.type === "NATIONWIDE") {
      return NextResponse.json({ error: "An active nationwide coverage rule already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "The coverage area could not be saved" }, { status: 409 });
  }
}
