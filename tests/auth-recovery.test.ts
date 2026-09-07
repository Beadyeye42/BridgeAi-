import { describe, expect, it } from "vitest";
import { recoverySessionFromHash, safeAuthNextPath } from "../lib/auth/recovery-hash";

describe("authentication recovery redirects", () => {
  it("accepts recovery and invitation sessions from legacy Supabase hash links", () => {
    expect(recoverySessionFromHash("#access_token=access&refresh_token=refresh&type=recovery")).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
    });
    expect(recoverySessionFromHash("#access_token=access&refresh_token=refresh&type=invite")).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
    });
  });

  it("rejects incomplete or unrelated hash links", () => {
    expect(recoverySessionFromHash("#access_token=access&type=recovery")).toBeNull();
    expect(recoverySessionFromHash("#access_token=access&refresh_token=refresh&type=signup")).toBeNull();
  });

  it("prevents protocol-relative callback redirects", () => {
    expect(safeAuthNextPath("/reset-password")).toBe("/reset-password");
    expect(safeAuthNextPath("//example.com")).toBe("/dashboard");
    expect(safeAuthNextPath("https://example.com")).toBe("/dashboard");
  });

  it.each(["/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "///evil.example"])("rejects URL parser bypass %j", (path) => {
    expect(safeAuthNextPath(path)).toBe("/dashboard");
  });

  it("preserves local queries and fragments and normalises path traversal", () => {
    expect(safeAuthNextPath("/reset-password?from=email#form")).toBe("/reset-password?from=email#form");
    expect(safeAuthNextPath("/buyer/../admin")).toBe("/admin");
  });
});
