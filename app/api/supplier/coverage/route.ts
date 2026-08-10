import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { coverageAreaSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { lookupPostcode, PostcodeLookupError } from "@/lib/location/postcodes";
import { distanceMiles } from "@/lib/matching/coverage";
import { DEFAULT_PLAN_IDS, effectiveMembershipLimits } from "@/lib/billing/membership-plans";
import { isMembershipActive } from "@/lib/billing/pricing";

export async function POST(request: Request) {
  const auth = await requireSupplierApi(); if ("error" in auth) return auth.error;
  const parsed = coverageAreaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });

  const company = await prisma.supplierCompany.findUnique({
    where: { id: auth.companyId },
    include: { subscription: { include: { membershipPlan: true } } },
  });
  if (!company) return NextResponse.json({ error: "Supplier company not found" }, { status: 404 });
  const activeSubscription = isMembershipActive(company.subscription) ? company.subscription : null;
  const plan = activeSubscription?.membershipPlan
    ?? await prisma.membershipPlan.findUnique({ where: { id: DEFAULT_PLAN_IDS.LOCAL } });
  if (!plan) return NextResponse.json({ error: "Membership plans are not configured" }, { status: 503 });
  const limits = effectiveMembershipLimits(plan, company);
  const purposeRadius = parsed.data.purpose === "SERVICE"
    ? limits.maximumServiceRadiusMiles
    : limits.maximumDeliveryRadiusMiles;
  if (parsed.data.type === "NATIONWIDE" && !limits.nationwideAllowed) {
    return NextResponse.json({ error: `${plan.name} does not include nationwide coverage` }, { status: 403 });
  }
  if (parsed.data.type === "POSTCODE") {
    return NextResponse.json({ error: "Postcode-area rules are no longer used. Choose one honest radius from your company base." }, { status: 422 });
  }
  if (parsed.data.type === "DISTANCE" && purposeRadius !== null && parsed.data.radiusMiles > purposeRadius) {
    return NextResponse.json({ error: `${plan.name} allows a maximum ${purposeRadius}-mile ${parsed.data.purpose.toLowerCase()} radius` }, { status: 403 });
  }

  let data: Prisma.CoverageAreaUncheckedCreateInput;
  let geographicOrigin: { postcode: string; latitude: number; longitude: number } | null = null;
  try {
    if (parsed.data.type === "DISTANCE") {
      const location = await lookupPostcode(parsed.data.centrePostcode);
      geographicOrigin = company.geographicOriginLatitude !== null && company.geographicOriginLongitude !== null
        ? {
          postcode: company.geographicOriginPostcode ?? company.postcode ?? location.postcode,
          latitude: Number(company.geographicOriginLatitude),
          longitude: Number(company.geographicOriginLongitude),
        }
        : await lookupPostcode(company.geographicOriginPostcode ?? company.postcode ?? location.postcode);
      if (purposeRadius !== null) {
        const offsetFromCompanyBase = distanceMiles(geographicOrigin, location);
        if (offsetFromCompanyBase + parsed.data.radiusMiles > purposeRadius + 0.01) {
          return NextResponse.json({
            error: `${plan.name} coverage must stay within ${purposeRadius} miles of your company base (${geographicOrigin.postcode}).`,
          }, { status: 403 });
        }
      }
      data = {
        supplierCompanyId: auth.companyId,
        purpose: parsed.data.purpose,
        type: parsed.data.type,
        label: parsed.data.label ?? `${location.postcode} base`,
        centrePostcode: location.postcode,
        radiusMiles: parsed.data.radiusMiles,
        latitude: location.latitude,
        longitude: location.longitude,
      };
    } else {
      data = { supplierCompanyId: auth.companyId, purpose: parsed.data.purpose, type: parsed.data.type, label: parsed.data.label ?? `Nationwide ${parsed.data.purpose.toLowerCase()}` };
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
        purpose: data.purpose,
        type: data.type,
        active: true,
        ...(data.type === "DISTANCE" ? { centrePostcode: data.centrePostcode, radiusMiles: data.radiusMiles }
          : data.type === "POSTCODE" ? { postcodePrefix: data.postcodePrefix }
          : {}),
      };
      const existing = await tx.coverageArea.findFirst({ where: duplicateWhere });
      if (existing) return { area: existing, alreadyExists: true };

      if (geographicOrigin && (company.geographicOriginLatitude === null || company.geographicOriginLongitude === null)) {
        await tx.supplierCompany.update({
          where: { id: auth.companyId },
          data: {
            geographicOriginPostcode: geographicOrigin.postcode,
            geographicOriginLatitude: geographicOrigin.latitude,
            geographicOriginLongitude: geographicOrigin.longitude,
          },
        });
      }
      const saved = await tx.coverageArea.create({ data });
      await writeAuditLog({ actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "COVERAGE.CREATED", entityType: "CoverageArea", entityId: saved.id, summary: `${saved.purpose.toLowerCase()} coverage ${saved.label} created`, metadata: { type: saved.type, purpose: saved.purpose, radiusMiles: saved.radiusMiles, membershipPlanId: plan.id, onboardingDefault: !activeSubscription?.membershipPlan }, request }, tx);
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
