import { describe, expect, it } from "vitest";
import {
  PROFILE_SYSTEM_OPTIONS_BY_CATEGORY,
  PHE_MANUFACTURER_OPTIONS_BY_CATEGORY,
  PHE_SYSTEM_OPTIONS_BY_CATEGORY,
  isPheCapabilityCategory,
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

  it("provides PHE-specific manufacturer and system choices", () => {
    expect(PHE_MANUFACTURER_OPTIONS_BY_CATEGORY["heat-pumps"]).toContain("Mitsubishi Electric");
    expect(PHE_MANUFACTURER_OPTIONS_BY_CATEGORY["boilers-heating-packages"]).toContain("Worcester Bosch");
    expect(PHE_SYSTEM_OPTIONS_BY_CATEGORY["heat-pumps"]).toContain("Air source");
    expect(PHE_SYSTEM_OPTIONS_BY_CATEGORY["pipework-fittings"]).toContain("MLCP");
    expect(isPheCapabilityCategory("pumps-pressurisation")).toBe(true);
    expect(isPheCapabilityCategory("upvc-windows")).toBe(false);
  });
});
