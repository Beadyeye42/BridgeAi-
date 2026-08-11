import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { adminSupplierGeographySchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsed = adminSupplierGeographySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const { id } = await params;
  const existing = await prisma.supplierCompany.findUnique({
    where: { id },
    select: {
      id: true,
      subscription: {
        select: { status: true, currentPeriodEnd: true, membershipPlan: { select: { tier: true } } },
      },
    },
  });
  if (!existing) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  const activeSubscription = existing.subscription?.status === "ACTIVE"
    && (!existing.subscription.currentPeriodEnd || existing.subscription.currentPeriodEnd > new Date());
  const purchasedTier = activeSubscription ? existing.subscription?.membershipPlan?.tier ?? "LOCAL" : "LOCAL";
  const tierRank = { HYPERLOCAL: 0, LOCAL: 1, REGIONAL: 2, NATIONWIDE: 3 } as const;
  const purchasedRadius = purchasedTier === "HYPERLOCAL" ? 10 : purchasedTier === "LOCAL" ? 40 : purchasedTier === "REGIONAL" ? 100 : null;
  if (parsed.data.membershipTierOverride && tierRank[parsed.data.membershipTierOverride] > tierRank[purchasedTier]) {
    return NextResponse.json({ error: "Upgrade the supplier membership plan to expand its geographic access." }, { status: 400 });
  }
  if (purchasedRadius !== null && (
    (parsed.data.maximumServiceRadiusOverride ?? 0) > purchasedRadius
    || (parsed.data.maximumDeliveryRadiusOverride ?? 0) > purchasedRadius
  )) {
    return NextResponse.json({ error: `This membership is limited to ${purchasedRadius} miles. Upgrade the plan to extend it.` }, { status: 400 });
  }
  const saved = await prisma.$transaction(async (tx) => {
    const company = await tx.supplierCompany.update({ where: { id }, data: parsed.data });
    await writeAuditLog({ actorUserId: auth.session.userId, supplierCompanyId: id, action: "ADMIN.SUPPLIER_GEOGRAPHY_OVERRIDDEN", entityType: "SupplierCompany", entityId: id, summary: "Administrator updated supplier geographic membership overrides", metadata: parsed.data, request }, tx);
    return company;
  });
  return NextResponse.json({ ok: true, company: saved });
}
