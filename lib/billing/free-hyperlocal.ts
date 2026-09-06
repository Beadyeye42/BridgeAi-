import "server-only";
import { runAsDatabaseWorker } from "@/lib/db";
import { FREE_HYPERLOCAL_PLAN_ID } from "@/lib/billing/membership-plans";

export async function activateFreeHyperlocal(companyId: string, actorUserId: string) {
  return runAsDatabaseWorker("stripe_billing", async (tx) => {
    // actorUserId comes from requireSupplierApi, never the submitted body.
    await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub', ${actorUserId}, true)`;
    await tx.$queryRaw`SELECT id FROM bridge_ai.supplier_companies WHERE id = ${companyId} FOR UPDATE`;
    const membership = await tx.supplierTeamMembership.findFirst({
      where: { supplierCompanyId: companyId, userId: actorUserId, status: "ACTIVE", role: { in: ["OWNER", "MANAGER"] } },
      include: { supplierCompany: true },
    });
    if (membership?.supplierCompany.status !== "APPROVED") throw new Error("FREE_MEMBERSHIP_FORBIDDEN");
    const plan = await tx.membershipPlan.findFirst({ where: { id: FREE_HYPERLOCAL_PLAN_ID, active: true } });
    if (!plan) throw new Error("FREE_MEMBERSHIP_UNAVAILABLE");
    const current = await tx.subscription.findUnique({ where: { supplierCompanyId: companyId } });
    // Never cancel billing, clear an unresolved provider subscription or replace
    // a paid entitlement just because a supplier clicked the free option.
    if (current && current.accessSource !== "FREE" && (
      !["EXPIRED", "CANCELLED"].includes(current.status)
      || (current.providerSubscriptionId && current.status !== "CANCELLED")
    )) {
      throw new Error("EXISTING_MEMBERSHIP_IN_PROGRESS");
    }
    const now = new Date();
    const data = {
      provider: "bridge-ai", planCode: plan.code, membershipPlanId: plan.id,
      accessSource: "FREE" as const, status: "ACTIVE" as const,
      currentPeriodStart: now, currentPeriodEnd: null, cancelAtPeriodEnd: false,
      providerSubscriptionId: null, providerScheduleId: null, promotionId: null, trialEndsAt: null,
      complimentaryReason: null, complimentaryGrantedAt: null, complimentaryGrantedById: null,
      complimentaryRevokedAt: null, complimentaryRevokedById: null, complimentaryRevocationReason: null,
    };
    const saved = await tx.subscription.upsert({
      where: { supplierCompanyId: companyId },
      create: { supplierCompanyId: companyId, ...data }, update: data,
    });
    await tx.auditLog.create({ data: {
      actorUserId, supplierCompanyId: companyId, action: "BILLING.FREE_HYPERLOCAL_ACTIVATED",
      entityType: "Subscription", entityId: saved.id,
      summary: "Supplier activated free access within two miles of its registered base",
      metadata: { membershipPlanId: plan.id, radiusMiles: 2, monthlyPricePence: 0 },
    } });
    return saved;
  });
}
