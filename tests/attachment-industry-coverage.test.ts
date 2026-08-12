import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("attachment intelligence covers every launched industry family", () => {
  const source = readFileSync("lib/ai/attachment-intake.ts", "utf8");

  it.each([
    "windows, doors, bifolds",
    "plumbing, heating and mechanical",
    "transport and removals",
    "local automotive work",
    "cleaning, clearance, gardening",
    "appliance repair, locksmith, security",
  ])("includes %s guidance", (guidance) => {
    expect(source.toLocaleLowerCase("en-GB")).toContain(guidance);
  });

  it("keeps regulated and safety-sensitive decisions with verified suppliers", () => {
    expect(source).toContain("Supplier eligibility and verification are enforced separately");
    expect(source).toContain("never diagnose a fault or judge roadworthiness");
    expect(source).toContain("Never infer weight, vehicle size, licences or safe lifting method");
  });

  it("accepts useful consumer, business, transport and service evidence", () => {
    expect(source).toContain("sourcing, hire, make, service, transport or removal photo");
    expect(source).not.toContain("any relevant trade photo");
  });
});
