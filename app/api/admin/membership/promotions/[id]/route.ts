import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { membershipPromotionAdminSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if ("error" in auth) return auth.error;
  const parsed = membershipPromotionAdminSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const { id } = await params;
  const plans = await prisma.membershipPlan.findMany({ where: { code: { in: parsed.data.eligiblePlanCodes } }, select: { code: true, monthlyPricePence: true } });
  if (plans.length !== parsed.data.eligiblePlanCodes.length || plans.some((plan) => parsed.data.promotionalPricePence >= plan.monthlyPricePence)) return NextResponse.json({ error: "Promotion must use configured plans and a lower price" }, { status: 400 });
  const promotion = await prisma.$transaction(async (tx) => {
    const saved = await tx.membershipPromotion.update({ where: { id }, data: { ...parsed.data, providerCouponIds: Prisma.JsonNull } });
    await writeAuditLog({ actorUserId: auth.session.userId, action: "ADMIN.MEMBERSHIP_PROMOTION_UPDATED", entityType: "MembershipPromotion", entityId: saved.id, summary: "Membership promotion updated", metadata: parsed.data, request }, tx);
    return saved;
  });
  return NextResponse.json({ ok: true, promotion });
}
