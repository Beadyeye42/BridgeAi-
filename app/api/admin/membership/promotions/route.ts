import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { membershipPromotionAdminSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: Request) {
  const auth = await requireAdminApi(); if ("error" in auth) return auth.error;
  const parsed = membershipPromotionAdminSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const plans = await prisma.membershipPlan.findMany({ where: { code: { in: parsed.data.eligiblePlanCodes } }, select: { code: true, monthlyPricePence: true } });
  if (plans.length !== parsed.data.eligiblePlanCodes.length) return NextResponse.json({ error: "Choose only configured membership plans" }, { status: 400 });
  if (plans.some((plan) => parsed.data.promotionalPricePence >= plan.monthlyPricePence)) return NextResponse.json({ error: "Promotional price must be lower than every eligible plan price" }, { status: 400 });
  const promotion = await prisma.$transaction(async (tx) => {
    const saved = await tx.membershipPromotion.create({ data: parsed.data });
    await writeAuditLog({ actorUserId: auth.session.userId, action: "ADMIN.MEMBERSHIP_PROMOTION_CREATED", entityType: "MembershipPromotion", entityId: saved.id, summary: "Membership promotion created", metadata: parsed.data, request }, tx);
    return saved;
  });
  return NextResponse.json({ ok: true, promotion }, { status: 201 });
}
