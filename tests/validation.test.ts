import { describe, expect, it } from "vitest";
import { assignmentDecisionSchema, registerSchema } from "../lib/auth/validation";

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
});
