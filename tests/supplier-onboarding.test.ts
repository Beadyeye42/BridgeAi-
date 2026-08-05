import { describe, expect, it } from "vitest";
import { supplierOnboardingReadiness, type SupplierOnboardingInput } from "../lib/suppliers/onboarding";

const completeSupplier = (): SupplierOnboardingInput => ({
  legalName: "Secure Trade Supplies Ltd",
  contactEmail: "quotes@example.test",
  contactPhone: "01234567890",
  addressLine1: "1 Trade Park",
  city: "Cheltenham",
  postcode: "GL52 6TD",
  summary: "Approved supplier of made-to-measure trade products.",
  businessHours: { monday: ["08:00", "17:00"], saturday: null },
  categories: [{}],
  coverageAreas: [{ active: true }],
  memberships: [{ role: "OWNER", status: "ACTIVE" }],
  accreditations: [{ status: "APPROVED", expiresAt: new Date("2027-01-01T00:00:00Z"), attachment: { scanStatus: "CLEAN" } }],
});

describe("supplier onboarding readiness", () => {
  it("requires every approval prerequisite", () => {
    const result = supplierOnboardingReadiness(completeSupplier(), new Date("2026-08-05T12:00:00Z"));
    expect(result.ready).toBe(true);
    expect(result.percentage).toBe(100);
    expect(result.blockers).toEqual([]);
  });

  it("rejects expired evidence and incomplete matching configuration", () => {
    const supplier = completeSupplier();
    supplier.categories = [];
    supplier.coverageAreas = [{ active: false }];
    supplier.accreditations[0]!.expiresAt = new Date("2026-01-01T00:00:00Z");
    const result = supplierOnboardingReadiness(supplier, new Date("2026-08-05T12:00:00Z"));
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(["Product categories", "Coverage area", "Approved accreditation or insurance"]);
  });

  it("does not treat an empty hours object or pending file as approval-ready", () => {
    const supplier = completeSupplier();
    supplier.businessHours = {};
    supplier.accreditations[0]!.status = "PENDING";
    expect(supplierOnboardingReadiness(supplier).blockers).toEqual([
      "Business hours",
      "Approved accreditation or insurance",
    ]);
  });
});
