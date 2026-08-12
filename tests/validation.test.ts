import { describe, expect, it } from "vitest";
import { affiliateProfileAdminSchema, affiliateProgrammeAdminSchema, assignmentDecisionSchema, registerSchema } from "../lib/auth/validation";

describe("supplier input validation", () => {
  it("normalises a valid supplier registration", () => {
    const value = registerSchema.parse({ firstName: " Sarah ", lastName: " Mitchell ", companyName: " Northstar Steel ", email: "SARAH@EXAMPLE.COM", phone: "+44 121 555 0184", password: "StrongPassword2026", termsAccepted: true });
    expect(value.email).toBe("sarah@example.com");
    expect(value.companyName).toBe("Northstar Steel");
  });

  it("accepts eight-character passwords that meet the complexity rule", () => {
    expect(registerSchema.safeParse({ firstName: "Sarah", lastName: "Mitchell", companyName: "Northstar", email: "sarah@example.com", phone: "01234567890", password: "Abc12345", termsAccepted: true }).success).toBe(true);
  });

  it("rejects passwords shorter than eight characters", () => {
    expect(registerSchema.safeParse({ firstName: "Sarah", lastName: "Mitchell", companyName: "Northstar", email: "sarah@example.com", phone: "01234567890", password: "Abc123", termsAccepted: true }).success).toBe(false);
  });

  it("accepts only explicit assignment decisions", () => {
    expect(assignmentDecisionSchema.safeParse({ decision: "accept" }).success).toBe(true);
    expect(assignmentDecisionSchema.safeParse({ decision: "delete" }).success).toBe(false);
  });

  it("bounds administrator affiliate programme controls", () => {
    expect(affiliateProgrammeAdminSchema.safeParse({ maximumActive: 10, commissionRateBps: 1600, qualificationPayments: 1, commissionPayments: 12, validationDays: 30 }).success).toBe(true);
    expect(affiliateProgrammeAdminSchema.safeParse({ maximumActive: 0, commissionRateBps: 1600, qualificationPayments: 1, commissionPayments: 12, validationDays: 30 }).success).toBe(false);
    expect(affiliateProgrammeAdminSchema.safeParse({ maximumActive: 10, commissionRateBps: 10_001, qualificationPayments: 1, commissionPayments: 12, validationDays: 30 }).success).toBe(false);
  });

  it("normalises affiliate identity controls and supports the programme default rate", () => {
    expect(affiliateProfileAdminSchema.parse({ displayName: " Partner One ", code: "partner01", commissionRateBps: null })).toEqual({ displayName: "Partner One", code: "PARTNER01", commissionRateBps: null });
  });
});
