import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { authUserWasCreatedForRequest, supplierBootstrapError } from "@/lib/auth/registration-safety";

describe("supplier registration safety", () => {
  it("only cleans up an Auth user created by the current request", () => {
    const startedAt = Date.parse("2026-08-10T13:34:18.000Z");
    expect(authUserWasCreatedForRequest("2026-08-10T13:34:18.250Z", startedAt)).toBe(true);
    expect(authUserWasCreatedForRequest("2026-08-06T14:35:13.655Z", startedAt)).toBe(false);
    expect(authUserWasCreatedForRequest(undefined, startedAt)).toBe(false);
  });

  it("returns safe, useful messages for expected registration conflicts", () => {
    expect(supplierBootstrapError(new Error("portal profile already exists"))).toEqual({
      status: 409,
      message: "This email is already linked to a Bridge AI account. Sign in, reset the password, or contact support if you cannot access it.",
    });
    expect(supplierBootstrapError(new Error("invalid affiliate referral code"))).toEqual({
      status: 400,
      message: "This affiliate referral link is no longer valid.",
    });
  });

  it("preflights workspace and referral state before calling Supabase signUp", () => {
    const source = readFileSync("app/api/auth/register/route.ts", "utf8");
    expect(source.indexOf("preflight_supplier_registration")).toBeGreaterThan(-1);
    expect(source.indexOf("preflight_supplier_registration")).toBeLessThan(source.indexOf("supabase.auth.signUp"));
    expect(source).toContain("authUserWasCreatedForRequest(data.user.created_at, registrationStartedAt)");
  });
});
