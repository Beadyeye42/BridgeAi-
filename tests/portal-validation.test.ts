import { describe, expect, it } from "vitest";
import { adminAssignmentSchema, companyProfileSchema, coverageAreaSchema, notificationPreferenceSchema } from "../lib/auth/validation";

describe("supplier portal validation", () => {
  it("normalises postcode coverage prefixes", () => {
    expect(coverageAreaSchema.parse({ type: "POSTCODE", label: "Coventry", postcodePrefix: "cv" })).toEqual({ type: "POSTCODE", label: "Coventry", postcodePrefix: "CV" });
  });

  it("rejects excessive distance coverage", () => {
    expect(coverageAreaSchema.safeParse({ type: "DISTANCE", label: "Everywhere", centrePostcode: "B1 1AA", radiusMiles: 501 }).success).toBe(false);
  });

  it("requires at least one supplier assignment target", () => {
    expect(adminAssignmentSchema.safeParse({ quoteRequestId: "request_1", supplierCompanyIds: [] }).success).toBe(false);
  });

  it("never accepts more than five supplier assignment targets", () => {
    expect(adminAssignmentSchema.safeParse({ quoteRequestId: "request_1", supplierCompanyIds: ["1", "2", "3", "4", "5"] }).success).toBe(true);
    expect(adminAssignmentSchema.safeParse({ quoteRequestId: "request_1", supplierCompanyIds: ["1", "2", "3", "4", "5", "6"] }).success).toBe(false);
  });

  it("accepts complete notification preferences", () => {
    expect(notificationPreferenceSchema.safeParse({ emailNewRequests: true, emailRequestReminders: true, emailQuotationUpdates: true, smsUrgentRequests: false, inAppEnabled: true, quietHoursStart: "19:00", quietHoursEnd: "07:00" }).success).toBe(true);
  });

  it("rejects malformed business hours", () => {
    const result = companyProfileSchema.safeParse({ legalName: "Northstar Steel Ltd", tradingName: "", companyNumber: "", vatNumber: "", websiteUrl: "", summary: "", contactEmail: "quotes@example.com", contactPhone: "+441215550184", addressLine1: "", addressLine2: "", city: "", county: "", postcode: "", categoryIds: [], businessHours: { monday: ["8am", "5pm"] } });
    expect(result.success).toBe(false);
  });
});
