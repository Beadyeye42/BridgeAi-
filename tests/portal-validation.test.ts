import { describe, expect, it } from "vitest";
import { accreditationReviewSchema, accreditationUploadSchema, adminAssignmentSchema, companyProfileSchema, coverageAreaSchema, notificationPreferenceSchema, quotationSchema, recordIdSchema, supplierCapabilityActivationSchema } from "../lib/auth/validation";

describe("supplier portal validation", () => {
  it("normalises postcode coverage prefixes", () => {
    expect(coverageAreaSchema.parse({ type: "POSTCODE", label: "Coventry", postcodePrefix: "cv" })).toEqual({ type: "POSTCODE", purpose: "DELIVERY", label: "Coventry", postcodePrefix: "CV" });
    expect(coverageAreaSchema.parse({ type: "POSTCODE", postcodePrefix: "gl52 6td" })).toEqual({ type: "POSTCODE", purpose: "DELIVERY", postcodePrefix: "GL52 6TD" });
  });

  it("rejects excessive distance coverage", () => {
    expect(coverageAreaSchema.safeParse({ type: "DISTANCE", label: "Everywhere", centrePostcode: "B1 1AA", radiusMiles: 501 }).success).toBe(false);
  });

  it("accepts preset, custom and nationwide coverage rules", () => {
    expect(coverageAreaSchema.safeParse({ type: "DISTANCE", centrePostcode: "B1 1AA", radiusMiles: 40 }).success).toBe(true);
    expect(coverageAreaSchema.safeParse({ type: "DISTANCE", centrePostcode: "B1 1AA", radiusMiles: 100 }).success).toBe(true);
    expect(coverageAreaSchema.parse({ type: "NATIONWIDE" })).toEqual({ type: "NATIONWIDE", purpose: "DELIVERY" });
  });

  it("validates one-click product activation without accepting extra control fields", () => {
    expect(supplierCapabilityActivationSchema.parse({ productCategoryId: "upvc-windows", active: false })).toEqual({ productCategoryId: "upvc-windows" });
    expect(supplierCapabilityActivationSchema.safeParse({ productCategoryId: "" }).success).toBe(false);
  });

  it("requires at least one supplier assignment target", () => {
    expect(adminAssignmentSchema.safeParse({ quoteRequestId: "request_1", supplierCompanyIds: [] }).success).toBe(false);
  });

  it("never accepts more than three supplier assignment targets", () => {
    expect(adminAssignmentSchema.safeParse({ quoteRequestId: "request_1", supplierCompanyIds: ["1", "2", "3"] }).success).toBe(true);
    expect(adminAssignmentSchema.safeParse({ quoteRequestId: "request_1", supplierCompanyIds: ["1", "2", "3", "4"] }).success).toBe(false);
  });

  it("accepts complete notification preferences", () => {
    expect(notificationPreferenceSchema.safeParse({ emailNewRequests: true, emailRequestReminders: true, emailQuotationUpdates: true, smsUrgentRequests: false, inAppEnabled: true, quietHoursStart: "19:00", quietHoursEnd: "07:00" }).success).toBe(true);
  });

  it("requires complete quiet hours and preserves quotation validity through the selected day", () => {
    expect(notificationPreferenceSchema.safeParse({ emailNewRequests: true, emailRequestReminders: true, emailQuotationUpdates: true, smsUrgentRequests: false, inAppEnabled: true, quietHoursStart: "19:00", quietHoursEnd: null }).success).toBe(false);
    const quotation = quotationSchema.parse({ assignmentId: "cm00000000000000000000000", price: "1250.50", leadTimeDays: "14", validUntil: "2099-12-31" });
    expect(quotation.validUntil?.toISOString()).toBe("2099-12-31T23:59:59.999Z");
  });

  it("accepts opaque opportunity-claim identifiers when submitting quotations", () => {
    const claimedAssignmentId = "claim_f8625a74a1134eae9d0b4d8e40e1d3f1";
    expect(quotationSchema.safeParse({ assignmentId: claimedAssignmentId, price: "1250.50", leadTimeDays: "14" }).success).toBe(true);
    expect(recordIdSchema.safeParse("quotation-123_ABC").success).toBe(true);
    expect(recordIdSchema.safeParse("../../another-company").success).toBe(false);
    expect(recordIdSchema.safeParse("x".repeat(65)).success).toBe(false);
  });

  it("requires the simplified company identity, address and contact details", () => {
    const complete = { legalName: "Northstar Steel Ltd", companyNumber: "01234567", directorName: "Alex Morgan", contactEmail: "quotes@example.com", contactPhone: "+441215550184", addressLine1: "1 Trade Park", addressLine2: "", city: "Birmingham", county: "", postcode: "b1 1aa", categoryIds: [] };
    expect(companyProfileSchema.parse(complete).postcode).toBe("B1 1AA");
    expect(companyProfileSchema.safeParse({ ...complete, directorName: "" }).success).toBe(false);
    expect(companyProfileSchema.safeParse({ ...complete, addressLine1: "" }).success).toBe(false);
  });

  it("validates accreditation dates and review reasons", () => {
    expect(accreditationUploadSchema.safeParse({ type: "PUBLIC_LIABILITY_INSURANCE", displayName: "Public liability 2026", referenceNumber: "PL-2048", issuingBody: "Example Insurer", issuedAt: "2026-01-01", expiresAt: "2027-01-01" }).success).toBe(true);
    expect(accreditationUploadSchema.safeParse({ type: "CERTIFICATION", displayName: "Expired order", referenceNumber: "", issuingBody: "", issuedAt: "2027-01-01", expiresAt: "2026-01-01" }).success).toBe(false);
    expect(accreditationReviewSchema.safeParse({ status: "REJECTED", note: "" }).success).toBe(false);
    expect(accreditationReviewSchema.safeParse({ status: "APPROVED" }).success).toBe(true);
  });
});
