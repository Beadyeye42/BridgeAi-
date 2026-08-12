import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { affiliateProfileAdminSchema, affiliateStatusSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const payload = await request.json().catch(() => null);
  const statusUpdate = affiliateStatusSchema.safeParse(payload);
  const profileUpdate = affiliateProfileAdminSchema.safeParse(payload);
  if (!statusUpdate.success && !profileUpdate.success) {
    return NextResponse.json({ error: validationError(statusUpdate.error) }, { status: 400 });
  }
  const { id } = await params;
  try {
    const affiliate = await prisma.$transaction(async (tx) => {
      const before = await tx.affiliate.findUniqueOrThrow({ where: { id } });
      const profileData = profileUpdate.success ? profileUpdate.data : null;
      const data = statusUpdate.success ? {
          status: statusUpdate.data.status,
          approvedAt: statusUpdate.data.status === "ACTIVE" ? before.approvedAt ?? new Date() : before.approvedAt,
          approvedById: statusUpdate.data.status === "ACTIVE" ? auth.session.userId : before.approvedById,
          suspendedAt: statusUpdate.data.status === "SUSPENDED" ? new Date() : null,
          suspensionReason: statusUpdate.data.status === "SUSPENDED" ? statusUpdate.data.reason : null,
        } : {
          displayName: profileData?.displayName ?? before.displayName,
          code: profileData?.code ?? before.code,
          commissionRateBps: profileData?.commissionRateBps ?? null,
        };
      const saved = await tx.affiliate.update({ where: { id }, data });
      const action = statusUpdate.success ? "ADMIN.AFFILIATE_STATUS_CHANGED" : "ADMIN.AFFILIATE_PROFILE_UPDATED";
      const summary = statusUpdate.success
        ? `Affiliate status changed from ${before.status} to ${saved.status}`
        : "Affiliate identity and commission controls updated";
      const metadata = statusUpdate.success
        ? { reason: statusUpdate.data.reason ?? null }
        : { before: { displayName: before.displayName, code: before.code, commissionRateBps: before.commissionRateBps }, after: profileData };
      await tx.affiliateAuditLog.create({ data: { affiliateId: id, actorUserId: auth.session.userId, action, entityType: "Affiliate", entityId: id, summary, metadata } });
      await writeAuditLog({ actorUserId: auth.session.userId, action, entityType: "Affiliate", entityId: id, summary, metadata, request }, tx);
      return saved;
    });
    return NextResponse.json({ ok: true, affiliate });
  } catch (cause) {
    const message = cause instanceof Error && cause.message.includes("maximum active affiliate")
      ? "The programme has reached its active affiliate limit."
      : cause instanceof Error && cause.message.includes("Unique constraint")
        ? "That referral code is already in use."
        : "Affiliate controls could not be updated.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
