import { describe, expect, it } from "vitest";
import {
  PROFILE_SYSTEM_OPTIONS_BY_CATEGORY,
  STANDARD_COLOUR_OPTIONS,
  normaliseCapabilityValue,
} from "../lib/capabilities/options";

describe("supplier capability selector options", () => {
  it("offers the agreed standard colour boxes", () => {
    expect(STANDARD_COLOUR_OPTIONS).toEqual([
      "White",
      "Black",
      "Anthracite grey",
      "Slate grey",
      "Agate grey",
      "Chartwell green",
      "Cream",
      "Irish oak",
      "Rosewood brown",
    ]);
  });

  it("offers the agreed uPVC and aluminium profile boxes", () => {
    expect(PROFILE_SYSTEM_OPTIONS_BY_CATEGORY["upvc-windows"]).toEqual([
      "Liniar",
      "Rehau",
      "Deceuninck",
      "Eurocell",
      "Profile 22",
    ]);
    expect(PROFILE_SYSTEM_OPTIONS_BY_CATEGORY["aluminium-windows"]).toEqual([
      "Smart Systems",
      "AluK",
      "Origin",
    ]);
  });

  it("normalises common profile-brand spellings", () => {
    expect(normaliseCapabilityValue("Smarts")).toBe("smart systems");
    expect(normaliseCapabilityValue("Alu UK")).toBe("aluk");
    expect(normaliseCapabilityValue("Profile22")).toBe("profile 22");
  });
});
