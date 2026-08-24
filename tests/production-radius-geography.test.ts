import fs from "node:fs";
import path from "node:path";
import type { FulfilmentMode, MembershipPlan, MembershipTier } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { effectiveMembershipLimits } from "../lib/billing/membership-plans";
import { hasCurrentGeographicOpportunityAccess } from "../lib/billing/opportunity-access";
import { distanceMiles } from "../lib/matching/coverage";
import { evaluateCapability } from "../lib/matching/suppliers";
import {
  isCoverageBoundaryWithinGeographicRadius,
  isWithinGeographicRadius,
} from "../lib/matching/geographic-boundary";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const earthRadiusMiles = 3_958.7613;
const origin = { latitude: 51.9, longitude: -2.1 };
const now = new Date("2026-08-24T12:00:00Z");

function destinationAtMiles(miles: number, fulfilmentMode: FulfilmentMode = "DELIVERY") {
  const latitude = origin.latitude + (miles / earthRadiusMiles) * (180 / Math.PI);
  return { deliveryLatitude: latitude, deliveryLongitude: origin.longitude, fulfilmentMode };
}

function plan(tier: MembershipTier, maximumRadiusMiles: number | null): MembershipPlan {
  return {
    id: `plan_${tier.toLowerCase()}`,
    code: tier.toLowerCase(),
    name: tier,
    tier,
    description: null,
    monthlyPricePence: 2_999,
    currency: "GBP",
    maximumRadiusMiles,
    nationwideAllowed: tier === "NATIONWIDE",
    maximumActiveOpportunities: 5,
    taxEnabled: false,
    providerProductId: null,
    providerPriceId: null,
    active: true,
    displayOrder: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function company(
  tier: MembershipTier,
  radius: number | null,
  options: {
    status?: "ACTIVE" | "PAST_DUE" | "PAUSED" | "CANCELLED" | "EXPIRED";
    currentPeriodEnd?: Date | null;
    maximumServiceRadiusOverride?: number | null;
    maximumDeliveryRadiusOverride?: number | null;
  } = {},
) {
  return {
    membershipTierOverride: null,
    maximumActiveOpportunitiesOverride: null,
    maximumServiceRadiusOverride: options.maximumServiceRadiusOverride ?? null,
    maximumDeliveryRadiusOverride: options.maximumDeliveryRadiusOverride ?? null,
    geographicOriginLatitude: origin.latitude,
    geographicOriginLongitude: origin.longitude,
    subscription: {
      status: options.status ?? "ACTIVE",
      currentPeriodEnd: options.currentPeriodEnd === undefined
        ? new Date("2026-09-24T12:00:00Z")
        : options.currentPeriodEnd,
      membershipPlan: plan(tier, radius),
    },
  };
}

describe("production membership radius boundaries", () => {
  it.each([
    ["Hyperlocal", 10, 9.99, true],
    ["Hyperlocal", 10, 10, true],
    ["Hyperlocal", 10, 10.01, false],
    ["Hyperlocal", 10, 11, false],
    ["Local", 40, 39.99, true],
    ["Local", 40, 40, true],
    ["Local", 40, 40.01, false],
    ["Local", 40, 41, false],
    ["Regional", 100, 99.99, true],
    ["Regional", 100, 100, true],
    ["Regional", 100, 100.01, false],
    ["Regional", 100, 101, false],
  ] as const)("%s: %s-mile boundary at %s miles is %s", (_name, radius, miles, expected) => {
    expect(isWithinGeographicRadius(miles, radius)).toBe(expected);
  });

  it.each([
    ["HYPERLOCAL", 10, 9.99, true],
    ["HYPERLOCAL", 10, 10, true],
    ["HYPERLOCAL", 10, 10.01, false],
    ["LOCAL", 40, 39.99, true],
    ["LOCAL", 40, 40, true],
    ["LOCAL", 40, 40.01, false],
    ["REGIONAL", 100, 99.99, true],
    ["REGIONAL", 100, 100, true],
    ["REGIONAL", 100, 100.01, false],
  ] as const)("enforces %s through the live opportunity-access path", (tier, radius, miles, expected) => {
    expect(hasCurrentGeographicOpportunityAccess(
      company(tier, radius),
      destinationAtMiles(miles),
      now,
    )).toBe(expected);
  });

  it.each([
    [7, 3, 10, true],
    [7, 3.01, 10, false],
    [30, 10, 40, true],
    [30, 10.01, 40, false],
    [70, 30, 100, true],
    [70, 30.01, 100, false],
  ])("blocks off-centre coverage exploits (%s + %s within %s)", (offset, coverage, permitted, expected) => {
    expect(isCoverageBoundaryWithinGeographicRadius(offset, coverage, permitted)).toBe(expected);
  });

  it("keeps service and delivery geography independent", () => {
    const restricted = company("REGIONAL", 100, {
      maximumServiceRadiusOverride: 20,
      maximumDeliveryRadiusOverride: 80,
    });
    expect(hasCurrentGeographicOpportunityAccess(restricted, destinationAtMiles(40, "INSTALLATION"), now)).toBe(false);
    expect(hasCurrentGeographicOpportunityAccess(restricted, destinationAtMiles(40, "DELIVERY"), now)).toBe(true);
  });

  it.each(["PAST_DUE", "PAUSED", "CANCELLED", "EXPIRED"] as const)(
    "fails closed for a %s subscription",
    (status) => {
      expect(hasCurrentGeographicOpportunityAccess(company("LOCAL", 40, { status }), destinationAtMiles(5), now)).toBe(false);
    },
  );

  it("expires access at period end and preserves unrestricted Nationwide geography only for an active plan", () => {
    expect(hasCurrentGeographicOpportunityAccess(company("NATIONWIDE", null), destinationAtMiles(500), now)).toBe(true);
    expect(hasCurrentGeographicOpportunityAccess(
      company("NATIONWIDE", null, { maximumDeliveryRadiusOverride: 40 }),
      destinationAtMiles(40.01),
      now,
    )).toBe(false);
    expect(hasCurrentGeographicOpportunityAccess(
      company("LOCAL", 40, { currentPeriodEnd: now }),
      destinationAtMiles(5),
      now,
    )).toBe(false);
  });

  it("never permits an administrator restriction to expand the purchased plan", () => {
    const limits = effectiveMembershipLimits(plan("LOCAL", 40), {
      membershipTierOverride: "NATIONWIDE",
      maximumActiveOpportunitiesOverride: 999,
      maximumServiceRadiusOverride: 500,
      maximumDeliveryRadiusOverride: 500,
    });
    expect(limits).toMatchObject({
      tier: "LOCAL",
      maximumRadiusMiles: 40,
      maximumServiceRadiusMiles: 40,
      maximumDeliveryRadiusMiles: 40,
      nationwideAllowed: false,
    });
  });
});

describe("real UK geographic calculations", () => {
  it.each([
    ["Severn crossing", { latitude: 51.4545, longitude: -2.5879 }, { latitude: 51.4816, longitude: -3.1791 }, 20, 30],
    ["Humber crossing", { latitude: 53.7676, longitude: -0.3274 }, { latitude: 53.5675, longitude: -0.0808 }, 15, 25],
    ["Isle of Wight", { latitude: 50.8198, longitude: -1.0880 }, { latitude: 50.7000, longitude: -1.2950 }, 10, 20],
    ["Highlands", { latitude: 55.8642, longitude: -4.2518 }, { latitude: 57.4778, longitude: -4.2247 }, 105, 115],
    ["Wales border", { latitude: 53.1934, longitude: -2.8931 }, { latitude: 53.0430, longitude: -2.9925 }, 10, 15],
    ["London to Leeds", { latitude: 51.5074, longitude: -0.1278 }, { latitude: 53.8008, longitude: -1.5491 }, 165, 175],
    ["Newcastle to Leeds", { latitude: 54.9783, longitude: -1.6178 }, { latitude: 53.8008, longitude: -1.5491 }, 80, 85],
  ])("uses stable straight-line distance for %s", (_name, from, to, minimum, maximum) => {
    const forward = distanceMiles(from, to);
    const reverse = distanceMiles(to, from);
    expect(forward).toBeGreaterThan(minimum);
    expect(forward).toBeLessThan(maximum);
    expect(reverse).toBeCloseTo(forward, 10);
  });
});

describe("geographic ranking", () => {
  it("gives an otherwise identical nearer supplier the stronger locality signal", () => {
    const capability = {
      id: "capability_locality",
      manufacturerNames: [],
      systemNames: [],
      colourNames: [],
      finishNames: [],
      minimumOrderValue: null,
      minimumOrderQuantity: null,
      standardLeadTimeDays: 7,
      urgentLeadTimeDays: null,
      currentLeadTimeDays: 7,
      collectionAvailable: false,
      supportsSupplyOnly: true,
      supportsDelivery: true,
      supportsInstallation: false,
      supportsService: false,
      deliveryDays: [1, 2, 3, 4, 5],
      capacityStatus: "AVAILABLE" as const,
      shortageNote: null,
      shortageUntil: null,
      lastConfirmedAt: now,
      capacityLastConfirmedAt: now,
      leadTimeLastConfirmedAt: now,
    };
    const request = {
      id: "request_locality",
      categoryId: "category",
      deliveryPostcode: "GL52 6TD",
      deliveryLatitude: origin.latitude,
      deliveryLongitude: origin.longitude,
      fulfilmentMode: "DELIVERY" as const,
      items: [{ quantity: 1 }],
    };
    const nearby = evaluateCapability(request, capability, {
      type: "DISTANCE",
      label: "Nearby",
      description: "Nearby supplier",
      distanceMiles: 5,
    }, now);
    const distant = evaluateCapability(request, capability, {
      type: "DISTANCE",
      label: "Distant",
      description: "Distant supplier",
      distanceMiles: 80,
    }, now);

    expect(nearby.outcome).toBe("MATCHED");
    expect(distant.outcome).toBe("MATCHED");
    expect(nearby.signals.locality).toBeGreaterThan(distant.signals.locality);
    expect(read("lib/matching/suppliers.ts")).toContain("result.signals.locality * weights.locality");
  });
});

describe("server and database anti-tampering controls", () => {
  it("geocodes supplier and administrator postcodes on the server", () => {
    const supplierCoverage = read("app/api/supplier/coverage/route.ts");
    const supplierProfile = read("app/api/supplier/company/route.ts");
    const administratorProfile = read("app/api/admin/suppliers/[id]/route.ts");
    expect(supplierCoverage).toContain("await lookupPostcode(parsed.data.centrePostcode)");
    expect(supplierCoverage).not.toContain("parsed.data.latitude");
    expect(supplierCoverage).not.toContain("parsed.data.longitude");
    expect(supplierProfile).toContain("await lookupPostcode(profile.postcode)");
    expect(administratorProfile).toContain("await lookupPostcode(parsed.data.postcode)");
  });

  it("hardens database boundaries, verified origins, history and automatic reconciliation", () => {
    const migration = read("supabase/migrations/20260824162950_production_radius_geography_hardening.sql");
    expect(migration).toContain("+ 0.0001");
    expect(migration).toContain("VERIFIED_COMPANY_POSTCODE_REQUIRED");
    expect(migration).toContain("SUPPLIER.GEOGRAPHIC_BASE_CHANGED");
    expect(migration).toContain("SUPPLIER_REPEATED_GEOGRAPHIC_BASE_CHANGES");
    expect(migration).toContain("reconcile_geographic_membership_after_supplier_change");
    expect(migration).toContain('AFTER UPDATE OF postcode, "geographicOriginPostcode"');
  });

  it("shows the required straight-line wording in the supplier portal", () => {
    const form = read("components/dashboard/management-forms.tsx");
    expect(form).toContain("Radius is measured in straight-line miles from your verified business location.");
  });

  it("applies geography before ranked capped distribution and excludes inactive collection branches", () => {
    const matching = read("lib/matching/suppliers.ts");
    const distribution = read("lib/matching/distribution.ts");
    expect(matching.indexOf("!isWithinGeographicRadius(companyDistance, purposeRadius)"))
      .toBeLessThan(matching.indexOf("evaluateCapability(request"));
    expect(matching).toContain("collectionLocations: { where: { active: true }");
    expect(distribution).toContain("Math.min");
    expect(distribution).toContain("5");
  });
});
