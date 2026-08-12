import type { FulfilmentMode, MembershipPlan, MembershipTier } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  canReadSupplierAssignment,
  hasCurrentGeographicOpportunityAccess,
} from "../lib/billing/opportunity-access";

function plan(tier: MembershipTier, maximumRadiusMiles: number | null): MembershipPlan {
  return {
    id: `plan_${tier.toLowerCase()}`,
    code: tier.toLowerCase(),
    name: tier,
    tier,
    description: null,
    monthlyPricePence: 2999,
    currency: "GBP",
    maximumRadiusMiles,
    nationwideAllowed: tier === "NATIONWIDE",
    maximumActiveOpportunities: 5,
    taxEnabled: false,
    providerProductId: null,
    providerPriceId: null,
    active: true,
    displayOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const origin = { latitude: 51.9, longitude: -2.1 };
const destination = (miles: number, fulfilmentMode: FulfilmentMode = "DELIVERY") => ({
  deliveryLatitude: origin.latitude,
  deliveryLongitude: origin.longitude + miles / (69 * Math.cos(origin.latitude * Math.PI / 180)),
  fulfilmentMode,
});

function company(tier: MembershipTier, radius: number | null, overrides = {}) {
  return {
    membershipTierOverride: null,
    maximumActiveOpportunitiesOverride: null,
    maximumServiceRadiusOverride: null,
    maximumDeliveryRadiusOverride: null,
    geographicOriginLatitude: origin.latitude,
    geographicOriginLongitude: origin.longitude,
    subscription: {
      status: "ACTIVE" as const,
      currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
      membershipPlan: plan(tier, radius),
    },
    ...overrides,
  };
}

const now = new Date("2026-08-12T12:00:00Z");

describe("current geographic opportunity access", () => {
  it.each([
    ["HYPERLOCAL", 10, 9, true],
    ["HYPERLOCAL", 10, 11, false],
    ["LOCAL", 40, 39, true],
    ["LOCAL", 40, 41, false],
    ["REGIONAL", 100, 99, true],
    ["REGIONAL", 100, 101, false],
  ] as const)("enforces %s membership at %s miles", (tier, radius, miles, expected) => {
    expect(hasCurrentGeographicOpportunityAccess(company(tier, radius), destination(miles), now)).toBe(expected);
  });

  it("allows unrestricted Nationwide requests and honours administrator restrictions", () => {
    expect(hasCurrentGeographicOpportunityAccess(company("NATIONWIDE", null), destination(400), now)).toBe(true);
    expect(hasCurrentGeographicOpportunityAccess(
      company("NATIONWIDE", null, { maximumDeliveryRadiusOverride: 40 }),
      destination(41),
      now,
    )).toBe(false);
  });

  it("fails closed when a paid radius cannot be verified", () => {
    expect(hasCurrentGeographicOpportunityAccess(
      company("LOCAL", 40, { geographicOriginLatitude: null, geographicOriginLongitude: null }),
      destination(5),
      now,
    )).toBe(false);
    expect(hasCurrentGeographicOpportunityAccess(
      company("LOCAL", 40),
      { deliveryLatitude: null, deliveryLongitude: null, fulfilmentMode: "DELIVERY" },
      now,
    )).toBe(false);
  });

  it("removes live lead access after expiry while retaining submitted quote history", () => {
    const expired = company("LOCAL", 40, {
      subscription: {
        status: "ACTIVE" as const,
        currentPeriodEnd: new Date("2026-08-11T23:59:59Z"),
        membershipPlan: plan("LOCAL", 40),
      },
    });
    const liveAssignment = { quotation: null, quoteRequest: destination(5) };
    const quotedAssignment = { quotation: { id: "quote_1" }, quoteRequest: destination(80) };
    expect(canReadSupplierAssignment(expired, liveAssignment, now)).toBe(false);
    expect(canReadSupplierAssignment(expired, quotedAssignment, now)).toBe(true);
  });

  it("applies a downgrade immediately to unquoted leads", () => {
    const assignment = { quotation: null, quoteRequest: destination(35) };
    expect(canReadSupplierAssignment(company("LOCAL", 40), assignment, now)).toBe(true);
    expect(canReadSupplierAssignment(company("HYPERLOCAL", 10), assignment, now)).toBe(false);
  });
});
