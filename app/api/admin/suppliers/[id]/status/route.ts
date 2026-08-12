import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { adminSupplierStatusSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { supplierApprovalReadiness } from "@/lib/suppliers/onboarding";
import { lookupPostcode, PostcodeLookupError } from "@/lib/location/postcodes";

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

  let verifiedLocation: Awaited<ReturnType<typeof lookupPostcode>> | null = null;
  if (parsed.data.status === "APPROVED"
    && (existing.geographicOriginLatitude === null || existing.geographicOriginLongitude === null)) {
    try {
      verifiedLocation = await lookupPostcode(existing.postcode ?? "");
    } catch (error) {
      if (error instanceof PostcodeLookupError) {
        return NextResponse.json({
          error: error.code === "GEOCODING_UNAVAILABLE"
            ? "Postcode verification is temporarily unavailable. No approval was recorded; try again shortly."
            : `The supplier postcode must be corrected before approval: ${error.message}.`,
        }, { status: error.code === "GEOCODING_UNAVAILABLE" ? 503 : 422 });
      }
      return NextResponse.json({
        error: "The supplier postcode could not be verified. No approval was recorded; try again shortly.",
      }, { status: 503 });
    }
  }

  const now = new Date();
  let foundingMemberNumber = existing.foundingMemberNumber;
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.supplierCompany.update({
        where: { id },
        data: {
          status: parsed.data.status,
          approvedAt: parsed.data.status === "APPROVED" ? now : existing.approvedAt,
          approvedById: parsed.data.status === "APPROVED" ? auth.session.userId : existing.approvedById,
          suspendedAt: parsed.data.status === "SUSPENDED" ? now : null,
          suspensionNote: parsed.data.status === "SUSPENDED" ? parsed.data.note : null,
          ...(verifiedLocation ? {
            postcode: verifiedLocation.postcode,
            geographicOriginPostcode: verifiedLocation.postcode,
            geographicOriginLatitude: verifiedLocation.latitude,
            geographicOriginLongitude: verifiedLocation.longitude,
          } : {}),
        },
      });
      foundingMemberNumber = updated.foundingMemberNumber;
      const referral = await tx.affiliateReferral.findUnique({ where: { supplierCompanyId: id } });
      if (referral && ["APPROVED", "REJECTED"].includes(parsed.data.status)) {
        const referralStatus = parsed.data.status === "APPROVED" ? "APPROVED" : "REJECTED";
        await tx.affiliateReferral.update({ where: { id: referral.id }, data: { status: referralStatus, approvedAt: referralStatus === "APPROVED" ? now : referral.approvedAt } });
        await tx.affiliateNotification.create({ data: { affiliateId: referral.affiliateId, type: "SYSTEM", title: referralStatus === "APPROVED" ? "Referred supplier approved" : "Referred supplier rejected", body: `${existing.legalName} has been ${referralStatus.toLowerCase()} by Bridge AI.`, actionUrl: "/affiliate/referrals" } });
        await tx.affiliateAuditLog.create({ data: { affiliateId: referral.affiliateId, actorUserId: auth.session.userId, action: "ADMIN.REFERRAL_SUPPLIER_STATUS_CHANGED", entityType: "AffiliateReferral", entityId: referral.id, summary: `Referred supplier changed to ${referralStatus}`, metadata: { supplierCompanyId: id } } });
      }
      await writeAuditLog({
        actorUserId: auth.session.userId,
        supplierCompanyId: id,
        action: `ADMIN.SUPPLIER_${parsed.data.status}`,
        entityType: "SupplierCompany",
        entityId: id,
        summary: `Supplier status changed from ${existing.status} to ${parsed.data.status}`,
        metadata: {
          note: parsed.data.note ?? null,
          foundingMemberNumber: updated.foundingMemberNumber,
          postcodeVerifiedDuringApproval: Boolean(verifiedLocation),
          readiness: readiness.items.map((item) => ({ key: item.key, complete: item.complete })),
        },
        request,
      }, tx);
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("FOUNDING_SUPPLIER_CAPACITY_REACHED")) {
      return NextResponse.json({ error: "All 100 founding supplier places have been allocated." }, { status: 409 });
    }
    if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2004")
      || (error instanceof Error && error.message.includes("supplier approval requirements are incomplete"))) {
      return NextResponse.json({ error: "Supplier approval requirements changed. Refresh and review the checklist again." }, { status: 409 });
    }
    if (error instanceof Error && error.message.includes("VERIFIED_COMPANY_POSTCODE_REQUIRED")) {
      return NextResponse.json({ error: "A verified company postcode is required before approval." }, { status: 409 });
    }
    throw error;
  }
  return NextResponse.json({ ok: true, status: parsed.data.status, foundingMemberNumber });
}
