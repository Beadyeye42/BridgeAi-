import { describe, expect, it } from "vitest";
import { buyerTypeAllowed, classifyBuyerType } from "../lib/whatsapp/buyer-classification";

describe("buyer audience classification", () => {
  it.each([
    ["I need this sofa moved from Cheltenham to London", "CONSUMER"],
    ["These windows are for my customer and I need them next Friday", "TRADE"],
    ["We need 12 pallets moved from our warehouse", "BUSINESS"],
    ["PERSONAL", "CONSUMER"],
    ["TRADE", "TRADE"],
    ["BUSINESS", "BUSINESS"],
  ] as const)("classifies %s", (message, expected) => {
    expect(classifyBuyerType(message)).toBe(expected);
  });

  it("does not guess when the wording is genuinely ambiguous", () => {
    expect(classifyBuyerType("I need six windows by Friday")).toBeNull();
  });

  it("keeps consumer requests fail-closed while retaining existing trade defaults", () => {
    expect(buyerTypeAllowed("CONSUMER", {})).toBe(false);
    expect(buyerTypeAllowed("TRADE", {})).toBe(true);
    expect(buyerTypeAllowed("BUSINESS", {})).toBe(true);
  });
});
