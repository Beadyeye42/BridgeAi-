import { describe, expect, it } from "vitest";
import { bestCoverageMatch, distanceMiles, matchCoverageRule, type CoverageRule } from "../lib/matching/coverage";

const birmingham = { latitude: 52.4862, longitude: -1.8904 };
const coventry = { postcode: "CV1 2WT", latitude: 52.4068, longitude: -1.5197 };

function distanceRule(radiusMiles: number): CoverageRule {
  return {
    type: "DISTANCE",
    label: "Birmingham depot",
    postcodePrefix: null,
    centrePostcode: "B1 1AA",
    radiusMiles,
    latitude: birmingham.latitude,
    longitude: birmingham.longitude,
  };
}

describe("supplier coverage matching", () => {
  it("calculates a realistic straight-line distance", () => {
    expect(distanceMiles(birmingham, coventry)).toBeGreaterThan(15);
    expect(distanceMiles(birmingham, coventry)).toBeLessThan(20);
  });

  it("matches a delivery inside a 40-mile depot radius", () => {
    const match = matchCoverageRule(distanceRule(40), coventry);
    expect(match?.type).toBe("DISTANCE");
    expect(match?.distanceMiles).toBeLessThan(40);
  });

  it("rejects deliveries outside the configured radius", () => {
    const london = { postcode: "SW1A 1AA", latitude: 51.501, longitude: -0.1416 };
    expect(matchCoverageRule(distanceRule(40), london)).toBeNull();
    expect(matchCoverageRule(distanceRule(100), london)).toBeNull();
  });

  it("matches postcode areas without coordinates", () => {
    const rule: CoverageRule = { type: "POSTCODE", label: "Coventry", postcodePrefix: "CV", centrePostcode: null, radiusMiles: null, latitude: null, longitude: null };
    expect(matchCoverageRule(rule, { postcode: "cv3 4fg", latitude: null, longitude: null })?.type).toBe("POSTCODE");
    expect(matchCoverageRule(rule, { postcode: "B1 1AA", latitude: null, longitude: null })).toBeNull();
  });

  it("matches nationwide coverage without coordinates", () => {
    const rule: CoverageRule = { type: "NATIONWIDE", label: "UK delivery", postcodePrefix: null, centrePostcode: null, radiusMiles: null, latitude: null, longitude: null };
    expect(matchCoverageRule(rule, { postcode: "IV1 1AA", latitude: null, longitude: null })?.description).toBe("Nationwide coverage");
  });

  it("fails closed for distance rules when coordinates are missing", () => {
    expect(matchCoverageRule(distanceRule(100), { postcode: "CV1 2WT", latitude: null, longitude: null })).toBeNull();
  });

  it("prefers a specific depot match over nationwide coverage", () => {
    const nationwide: CoverageRule = { type: "NATIONWIDE", label: "UK", postcodePrefix: null, centrePostcode: null, radiusMiles: null, latitude: null, longitude: null };
    expect(bestCoverageMatch([nationwide, distanceRule(40)], coventry)?.type).toBe("DISTANCE");
  });
});
