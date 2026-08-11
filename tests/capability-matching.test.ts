import { describe, expect, it } from "vitest";
import { evaluateCapability } from "../lib/matching/suppliers";

const now = new Date("2026-08-06T09:00:00.000Z");
const coverage = {
  type: "POSTCODE" as const,
  label: "Gloucester",
  description: "Postcode area GL",
  distanceMiles: null,
};

type Capability = Parameters<typeof evaluateCapability>[1];

function capability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "capability_1",
    manufacturerNames: ["Liniar"],
    systemNames: ["Liniar 70"],
    colourNames: ["Anthracite grey"],
    finishNames: ["Smooth"],
    minimumOrderValue: null,
    minimumOrderQuantity: 1,
    standardLeadTimeDays: 14,
    urgentLeadTimeDays: 7,
    collectionAvailable: true,
    deliveryDays: [1, 3, 5],
    capacityStatus: "AVAILABLE" as const,
    shortageNote: null,
    shortageUntil: null,
    lastConfirmedAt: new Date("2026-08-06T08:00:00.000Z"),
    ...overrides,
  };
}

const request = {
  id: "request_1",
  categoryId: "windows",
  deliveryPostcode: "GL52 6TD",
  deliveryLatitude: 51.9,
  deliveryLongitude: -2.1,
  requiredManufacturer: "Liniar",
  requiredSystem: "Liniar 70",
  requiredColour: "Anthracite grey",
  requiredFinish: "Smooth",
  requiredBy: new Date("2026-08-13T09:00:00.000Z"),
  collectionRequired: false,
  items: [{ quantity: 5 }],
};

describe("live supplier capability matching", () => {
  it("rejects consumer work unless the supplier explicitly opts in for that product", () => {
    const result = evaluateCapability(
      { ...request, buyerType: "CONSUMER" },
      capability({ servesConsumer: false, servesTrade: true, servesBusiness: true }),
      coverage,
      now,
    );
    expect(result.outcome).toBe("REJECTED");
    expect(result.reasons).toContain("Supplier does not serve consumer / homeowner requests for this product");
  });

  it("matches the same consumer request after an explicit supplier opt-in", () => {
    const result = evaluateCapability(
      { ...request, buyerType: "CONSUMER" },
      capability({ servesConsumer: true }),
      coverage,
      now,
    );
    expect(result.outcome).toBe("MATCHED");
    expect(result.reasons).toContain("Accepts consumer / homeowner requests for this product");
  });

  it("matches a fresh supplier that satisfies every mandatory requirement", () => {
    const result = evaluateCapability(request, capability(), coverage, now);
    expect(result.outcome).toBe("MATCHED");
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.reasons).toContain("Manufactures Liniar");
    expect(result.reasons).toContain("Offers colour Anthracite grey");
    expect(result.reasons).toContain("Current 7-day lead time meets the required date");
  });

  it.each([
    ["system", { systemNames: ["Residence 9"] }, "Does not confirm system Liniar 70"],
    ["colour", { colourNames: ["White"] }, "Does not confirm colour Anthracite grey"],
    ["capacity", { capacityStatus: "FULL" as const }, "Current capacity is full"],
  ])("rejects a supplier with an incompatible %s", (_label, overrides, reason) => {
    const result = evaluateCapability(request, capability(overrides), coverage, now);
    expect(result.outcome).toBe("REJECTED");
    expect(result.reasons).toContain(reason);
  });

  it("rejects stale lead-time data for a deadline-sensitive request", () => {
    const result = evaluateCapability(
      request,
      capability({ lastConfirmedAt: new Date("2026-07-01T09:00:00.000Z") }),
      coverage,
      now,
    );
    expect(result.outcome).toBe("REJECTED");
    expect(result.reasons).toContain("Lead-time confirmation is too old for a deadline-sensitive request");
  });

  it("enforces collection and minimum-order requirements", () => {
    const result = evaluateCapability(
      { ...request, collectionRequired: true, items: [{ quantity: 2 }] },
      capability({ collectionAvailable: false, minimumOrderQuantity: 5 }),
      coverage,
      now,
    );
    expect(result.outcome).toBe("REJECTED");
    expect(result.reasons).toContain("Collection is required but unavailable");
    expect(result.reasons).toContain("Order quantity is below the supplier minimum of 5");
  });

  it("matches a detailed system when its profile family is selected", () => {
    const result = evaluateCapability(
      { ...request, requiredSystem: "Liniar 70" },
      capability({ systemNames: ["Liniar"] }),
      coverage,
      now,
    );
    expect(result.outcome).toBe("MATCHED");
  });

  it("recognises common aluminium profile aliases", () => {
    const result = evaluateCapability(
      { ...request, requiredManufacturer: null, requiredSystem: "Smarts", requiredColour: null },
      capability({ systemNames: ["Smart Systems"] }),
      coverage,
      now,
    );
    expect(result.outcome).toBe("MATCHED");
  });

  it("uses the RAL checkbox for RAL-coded requests only", () => {
    const ral = evaluateCapability(
      { ...request, requiredColour: "RAL 7016" },
      capability({ colourNames: ["RAL colours"] }),
      coverage,
      now,
    );
    const named = evaluateCapability(
      { ...request, requiredColour: "Olive" },
      capability({ colourNames: ["RAL colours"] }),
      coverage,
      now,
    );
    expect(ral.outcome).toBe("MATCHED");
    expect(named.outcome).toBe("REJECTED");
  });

  it("limits legacy all-standard selection to recognised standard colours", () => {
    const standard = evaluateCapability(
      request,
      capability({ colourNames: ["All standard"] }),
      coverage,
      now,
    );
    const nonStandard = evaluateCapability(
      { ...request, requiredColour: "Olive" },
      capability({ colourNames: ["All standard"] }),
      coverage,
      now,
    );
    expect(standard.outcome).toBe("MATCHED");
    expect(nonStandard.outcome).toBe("REJECTED");
  });
});
