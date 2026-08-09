import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { affiliateStatusSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsed = affiliateStatusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const { id } = await params;
  try {
    const affiliate = await prisma.$transaction(async (tx) => {
      const before = await tx.affiliate.findUniqueOrThrow({ where: { id } });
      const saved = await tx.affiliate.update({ where: { id }, data: {
        status: parsed.data.status,
        approvedAt: parsed.data.status === "ACTIVE" ? before.approvedAt ?? new Date() : before.approvedAt,
        approvedById: parsed.data.status === "ACTIVE" ? auth.session.userId : before.approvedById,
        suspendedAt: parsed.data.status === "SUSPENDED" ? new Date() : null,
        suspensionReason: parsed.data.status === "SUSPENDED" ? parsed.data.reason : null,
      } });
      await tx.affiliateAuditLog.create({ data: { affiliateId: id, actorUserId: auth.session.userId, action: "ADMIN.AFFILIATE_STATUS_CHANGED", entityType: "Affiliate", entityId: id, summary: `Affiliate status changed from ${before.status} to ${saved.status}`, metadata: { reason: parsed.data.reason ?? null } } });
      await writeAuditLog({ actorUserId: auth.session.userId, action: "ADMIN.AFFILIATE_STATUS_CHANGED", entityType: "Affiliate", entityId: id, summary: `Affiliate status changed from ${before.status} to ${saved.status}`, request }, tx);
      return saved;
    });
    return NextResponse.json({ ok: true, affiliate });
  } catch (cause) {
    const message = cause instanceof Error && cause.message.includes("maximum active affiliate") ? "The programme has reached its active affiliate limit." : "Affiliate status could not be updated.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
