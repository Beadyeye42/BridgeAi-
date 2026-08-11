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
  if (current.tier === "HYPERLOCAL" && (parsed.data.maximumRadiusMiles === null || parsed.data.maximumRadiusMiles > 10)) return NextResponse.json({ error: "Hyperlocal Partner must remain between 1 and 10 miles" }, { status: 400 });
  if (current.tier === "LOCAL" && parsed.data.maximumRadiusMiles !== 40) return NextResponse.json({ error: "Local Partner is fixed at a maximum 40-mile radius" }, { status: 400 });
  if (current.tier === "REGIONAL" && parsed.data.maximumRadiusMiles !== 100) return NextResponse.json({ error: "Regional Partner is fixed at a maximum 100-mile radius" }, { status: 400 });
  if (current.tier === "NATIONWIDE" && (!parsed.data.nationwideAllowed || parsed.data.maximumRadiusMiles !== null)) return NextResponse.json({ error: "Nationwide membership must retain nationwide eligibility and no mileage ceiling" }, { status: 400 });
  if (current.tier !== "NATIONWIDE" && (parsed.data.nationwideAllowed || parsed.data.maximumRadiusMiles === null)) return NextResponse.json({ error: "Mileage-controlled plans require a radius and cannot enable nationwide eligibility" }, { status: 400 });
  const priceChanged = current.monthlyPricePence !== parsed.data.monthlyPricePence || current.taxEnabled !== parsed.data.taxEnabled;
  const explicitPriceChanged = parsed.data.providerPriceId !== current.providerPriceId;
  const saved = await prisma.$transaction(async (tx) => {
    const plan = await tx.membershipPlan.update({ where: { id }, data: { ...parsed.data, providerPriceId: priceChanged && !explicitPriceChanged ? null : parsed.data.providerPriceId } });
    await writeAuditLog({ actorUserId: auth.session.userId, action: "ADMIN.MEMBERSHIP_PLAN_UPDATED", entityType: "MembershipPlan", entityId: id, summary: `${plan.name} membership settings updated`, metadata: { tier: plan.tier, monthlyPricePence: plan.monthlyPricePence, maximumRadiusMiles: plan.maximumRadiusMiles, nationwideAllowed: plan.nationwideAllowed, maximumActiveOpportunities: plan.maximumActiveOpportunities, providerPriceChanged: explicitPriceChanged, displayOrder: plan.displayOrder, stripePriceRefreshRequired: priceChanged && !explicitPriceChanged }, request }, tx);
    return plan;
  });
  return NextResponse.json({ ok: true, plan: saved, stripePriceRefreshRequired: priceChanged && !explicitPriceChanged });
}
