import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { membershipPlanAdminSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(); if ("error" in auth) return auth.error;
  const parsed = membershipPlanAdminSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const { id } = await params;
  const current = await prisma.membershipPlan.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "Membership plan not found" }, { status: 404 });
  if (current.tier === "NATIONWIDE" && (!parsed.data.nationwideAllowed || parsed.data.maximumRadiusMiles !== null)) return NextResponse.json({ error: "Nationwide membership must retain nationwide eligibility and no mileage ceiling" }, { status: 400 });
  if (current.tier !== "NATIONWIDE" && (parsed.data.nationwideAllowed || parsed.data.maximumRadiusMiles === null)) return NextResponse.json({ error: "Local and Regional plans require a mileage ceiling and cannot enable nationwide eligibility" }, { status: 400 });
  const priceChanged = current.monthlyPricePence !== parsed.data.monthlyPricePence || current.taxEnabled !== parsed.data.taxEnabled;
  const saved = await prisma.$transaction(async (tx) => {
    const plan = await tx.membershipPlan.update({ where: { id }, data: { ...parsed.data, providerPriceId: priceChanged ? null : current.providerPriceId } });
    await writeAuditLog({ actorUserId: auth.session.userId, action: "ADMIN.MEMBERSHIP_PLAN_UPDATED", entityType: "MembershipPlan", entityId: id, summary: `${plan.name} membership settings updated`, metadata: { tier: plan.tier, monthlyPricePence: plan.monthlyPricePence, maximumRadiusMiles: plan.maximumRadiusMiles, nationwideAllowed: plan.nationwideAllowed, maximumActiveOpportunities: plan.maximumActiveOpportunities, taxEnabled: plan.taxEnabled, stripePriceRefreshRequired: priceChanged }, request }, tx);
    return plan;
  });
  return NextResponse.json({ ok: true, plan: saved, stripePriceRefreshRequired: priceChanged });
}
