import type { MembershipPlan } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectiveMembershipLimits, FREE_HYPERLOCAL_PLAN_ID } from "@/lib/billing/membership-plans";
import { hasCurrentGeographicOpportunityAccess } from "@/lib/billing/opportunity-access";
import { isWithinGeographicRadius } from "@/lib/matching/geographic-boundary";

const worker = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ runAsDatabaseWorker: worker }));
import { activateFreeHyperlocal } from "@/lib/billing/free-hyperlocal";

const plan = {
  id: FREE_HYPERLOCAL_PLAN_ID, code: "bridge-ai-free-hyperlocal", name: "Free Hyperlocal", tier: "HYPERLOCAL",
  monthlyPricePence: 0, maximumRadiusMiles: 2, nationwideAllowed: false,
  maximumActiveOpportunities: 3, active: true,
} as MembershipPlan;
const company = {
  membershipTierOverride: null, maximumActiveOpportunitiesOverride: null,
  maximumServiceRadiusOverride: null, maximumDeliveryRadiusOverride: null,
  geographicOriginLatitude: 0, geographicOriginLongitude: 0,
  subscription: { status: "ACTIVE" as const, currentPeriodEnd: null, membershipPlan: plan },
};

describe("free two-mile access", () => {
  it("accepts the inclusive two-mile boundary and rejects wider reach", () => {
    expect(effectiveMembershipLimits(plan, company).maximumRadiusMiles).toBe(2);
    expect(isWithinGeographicRadius(2, 2)).toBe(true);
    expect(isWithinGeographicRadius(2.001, 2)).toBe(false);
    expect(hasCurrentGeographicOpportunityAccess(company, { deliveryLatitude: 0, deliveryLongitude: 0.02, fulfilmentMode: "SERVICE" })).toBe(true);
    expect(hasCurrentGeographicOpportunityAccess(company, { deliveryLatitude: 0, deliveryLongitude: 0.04, fulfilmentMode: "SERVICE" })).toBe(false);
  });

  it("cannot widen free access through administrator overrides or absent coordinates", () => {
    expect(effectiveMembershipLimits(plan, { ...company, membershipTierOverride: "NATIONWIDE", maximumServiceRadiusOverride: 100 }).maximumServiceRadiusMiles).toBe(2);
    expect(hasCurrentGeographicOpportunityAccess({ ...company, geographicOriginLatitude: null }, { deliveryLatitude: 0, deliveryLongitude: 0, fulfilmentMode: "SERVICE" })).toBe(false);
  });
});

describe("free activation", () => {
  const tx = {
    $executeRaw: vi.fn(), $queryRaw: vi.fn(),
    supplierTeamMembership: { findFirst: vi.fn() },
    membershipPlan: { findFirst: vi.fn() },
    subscription: { findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  beforeEach(() => {
    vi.resetAllMocks();
    worker.mockImplementation((_role, work) => work(tx));
    tx.supplierTeamMembership.findFirst.mockResolvedValue({ supplierCompany: { status: "APPROVED" } });
    tx.membershipPlan.findFirst.mockResolvedValue(plan);
    tx.subscription.findUnique.mockResolvedValue(null);
    tx.subscription.upsert.mockResolvedValue({ id: "free-subscription" });
  });

  it("persists perpetual free access and its audit in the same transaction", async () => {
    await activateFreeHyperlocal("company", "verified-user");
    expect(tx.subscription.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({
      supplierCompanyId: "company", membershipPlanId: plan.id, accessSource: "FREE", status: "ACTIVE",
      currentPeriodEnd: null, providerSubscriptionId: null,
    }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: "verified-user", action: "BILLING.FREE_HYPERLOCAL_ACTIVATED" }) });
  });

  it("denies a caller without the approved company membership", async () => {
    tx.supplierTeamMembership.findFirst.mockResolvedValue(null);
    await expect(activateFreeHyperlocal("other-company", "verified-user")).rejects.toThrow("FREE_MEMBERSHIP_FORBIDDEN");
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
  });

  it("does not clear an expired subscription with unresolved provider billing", async () => {
    tx.subscription.findUnique.mockResolvedValue({ accessSource: "STRIPE", status: "EXPIRED", providerSubscriptionId: "sub_existing" });
    await expect(activateFreeHyperlocal("company", "verified-user")).rejects.toThrow("EXISTING_MEMBERSHIP_IN_PROGRESS");
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
  });

  it.each(["ACTIVE", "PAST_DUE", "TRIALING", "PAUSED"])("does not overwrite a %s paid subscription", async (status) => {
    tx.subscription.findUnique.mockResolvedValue({ accessSource: "STRIPE", status });
    await expect(activateFreeHyperlocal("company", "verified-user")).rejects.toThrow("EXISTING_MEMBERSHIP_IN_PROGRESS");
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
  });
});
