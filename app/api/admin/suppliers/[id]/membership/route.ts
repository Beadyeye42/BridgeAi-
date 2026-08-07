import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { adminComplimentaryMembershipSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { COMPLIMENTARY_PLAN_CODE, isMembershipActive } from "@/lib/billing/pricing";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsed = adminComplimentaryMembershipSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });

  const { id } = await params;
  const company = await prisma.supplierCompany.findUnique({
    where: { id },
    include: { subscription: true },
  });
  if (!company) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  if (company.status !== "APPROVED") {
    return NextResponse.json({ error: "Approve the supplier before granting membership" }, { status: 409 });
  }

  const now = new Date();
  if (parsed.data.action === "GRANT") {
    const grant = parsed.data;
    const plan = await prisma.membershipPlan.findFirst({ where: { id: grant.membershipPlanId, active: true } });
    if (!plan) return NextResponse.json({ error: "Choose an active membership tier" }, { status: 404 });
    const paidMembershipInProgress = company.subscription?.accessSource === "STRIPE"
      && !["CANCELLED", "EXPIRED"].includes(company.subscription.status);
    if (paidMembershipInProgress) {
      return NextResponse.json({ error: "This supplier has a live or unresolved Stripe membership. Resolve it in Stripe before granting free access." }, { status: 409 });
    }
    const currentPeriodEnd = new Date(now.getTime() + grant.durationDays * 24 * 60 * 60_000);
    const wasActiveComplimentary = company.subscription?.accessSource === "COMPLIMENTARY"
      && isMembershipActive(company.subscription, now);
    const subscription = await prisma.$transaction(async (tx) => {
      const saved = await tx.subscription.upsert({
        where: { supplierCompanyId: id },
        create: {
          supplierCompanyId: id,
          provider: "bridge-ai",
          planCode: COMPLIMENTARY_PLAN_CODE,
          membershipPlanId: plan.id,
          status: "ACTIVE",
          accessSource: "COMPLIMENTARY",
          currentPeriodStart: now,
          currentPeriodEnd,
          cancelAtPeriodEnd: false,
          complimentaryReason: grant.reason,
          complimentaryGrantedAt: now,
          complimentaryGrantedById: auth.session.userId,
        },
        update: {
          planCode: COMPLIMENTARY_PLAN_CODE,
          membershipPlanId: plan.id,
          status: "ACTIVE",
          accessSource: "COMPLIMENTARY",
          currentPeriodStart: now,
          currentPeriodEnd,
          trialEndsAt: null,
          cancelAtPeriodEnd: false,
          complimentaryReason: grant.reason,
          complimentaryGrantedAt: now,
          complimentaryGrantedById: auth.session.userId,
          complimentaryRevokedAt: null,
          complimentaryRevokedById: null,
          complimentaryRevocationReason: null,
        },
      });
      await writeAuditLog({
        actorUserId: auth.session.userId,
        supplierCompanyId: id,
        action: wasActiveComplimentary ? "ADMIN.COMPLIMENTARY_MEMBERSHIP_EXTENDED" : "ADMIN.COMPLIMENTARY_MEMBERSHIP_GRANTED",
        entityType: "Subscription",
        entityId: saved.id,
        summary: `Complimentary supplier membership ${wasActiveComplimentary ? "replaced with a new period" : "granted"} for ${grant.durationDays} days`,
        metadata: { durationDays: grant.durationDays, reason: grant.reason, expiresAt: currentPeriodEnd.toISOString(), membershipPlanId: plan.id, membershipTier: plan.tier },
        request,
      }, tx);
      return saved;
    });
    return NextResponse.json({ ok: true, accessSource: subscription.accessSource, expiresAt: subscription.currentPeriodEnd });
  }

  if (company.subscription?.accessSource !== "COMPLIMENTARY" || !isMembershipActive(company.subscription, now)) {
    return NextResponse.json({ error: "There is no active complimentary membership to revoke" }, { status: 409 });
  }
  const minimumEnd = new Date(company.subscription.currentPeriodStart!.getTime() + 1_000);
  const revokedPeriodEnd = now > minimumEnd ? now : minimumEnd;
  await prisma.$transaction(async (tx) => {
    const saved = await tx.subscription.update({
      where: { supplierCompanyId: id },
      data: {
        status: "EXPIRED",
        currentPeriodEnd: revokedPeriodEnd,
        complimentaryRevokedAt: now,
        complimentaryRevokedById: auth.session.userId,
        complimentaryRevocationReason: parsed.data.reason,
      },
    });
    await writeAuditLog({
      actorUserId: auth.session.userId,
      supplierCompanyId: id,
      action: "ADMIN.COMPLIMENTARY_MEMBERSHIP_REVOKED",
      entityType: "Subscription",
      entityId: saved.id,
      summary: "Complimentary supplier membership revoked",
      metadata: { reason: parsed.data.reason, revokedAt: now.toISOString() },
      request,
    }, tx);
  });
  return NextResponse.json({ ok: true, accessSource: "COMPLIMENTARY", status: "EXPIRED" });
}
