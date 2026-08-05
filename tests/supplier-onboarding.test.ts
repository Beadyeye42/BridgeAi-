import { describe, expect, it } from "vitest";
import { supplierApprovalReadiness, supplierOnboardingReadiness, type SupplierOnboardingInput } from "../lib/suppliers/onboarding";

const completeSupplier = (): SupplierOnboardingInput => ({
  legalName: "Secure Trade Supplies Ltd",
  companyNumber: "01234567",
  directorName: "Alex Morgan",
  contactEmail: "quotes@example.test",
  contactPhone: "01234567890",
  addressLine1: "1 Trade Park",
  city: "Cheltenham",
  postcode: "GL52 6TD",
  categories: [{}],
  coverageAreas: [{ active: true }],
  memberships: [{ role: "OWNER", status: "ACTIVE" }],
});

describe("supplier onboarding readiness", () => {
  it("approves a supplier from identity, address and contact details only", () => {
    const supplier = completeSupplier();
    supplier.categories = [];
    supplier.coverageAreas = [];
    const result = supplierApprovalReadiness(supplier);
    expect(result.ready).toBe(true);
    expect(result.percentage).toBe(100);
    expect(result.blockers).toEqual([]);
  });

  it("keeps product and coverage setup as separate quote-matching requirements", () => {
    const supplier = completeSupplier();
    supplier.categories = [];
    supplier.coverageAreas = [{ active: false }];
    const result = supplierOnboardingReadiness(supplier);
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(["Product categories", "Coverage area"]);
  });

  it("requires the Companies House number and director's name for approval", () => {
    const supplier = completeSupplier();
    supplier.companyNumber = null;
    supplier.directorName = null;
    expect(supplierApprovalReadiness(supplier).blockers).toEqual(["Company identity"]);
  });
});
