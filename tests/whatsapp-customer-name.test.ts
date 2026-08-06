import { describe, expect, it } from "vitest";
import {
  explicitPreferredFirstName,
  personaliseOpening,
  preferredFirstNameReply,
  profileFirstName,
} from "../lib/whatsapp/customer-name";

describe("WhatsApp customer first-name preference", () => {
  it.each([
    ["Brian Nangle", "Brian"],
    ["sarah", "Sarah"],
    ["MARY-JANE SMITH", "Mary-jane"],
    ["O’Connor", "O’Connor"],
  ])("uses a clear personal WhatsApp profile name %s", (profile, expected) => {
    expect(profileFirstName(profile)).toBe(expected);
  });

  it.each([
    "LP Windows Ltd",
    "Ironbridge Group",
    "Trade Door Supplies",
    "+44 7593 103459",
    "Sales & Service",
  ])("does not mistake a business profile for a first name: %s", (profile) => {
    expect(profileFirstName(profile)).toBeNull();
  });

  it.each([
    ["Call me Steve", "Steve"],
    ["please call me brian.", "Brian"],
    ["My first name is Siân", "Siân"],
    ["I'm tom", "Tom"],
  ])("accepts an explicit first-name preference: %s", (message, expected) => {
    expect(explicitPreferredFirstName(message)).toBe(expected);
  });

  it.each([
    "I'm looking for six windows",
    "I am after a quote",
    "Call me about the windows",
    "Yes",
    "Continue",
  ])("does not infer a name from ordinary quote wording: %s", (message) => {
    expect(explicitPreferredFirstName(message)).toBeNull();
  });

  it("accepts only a safe single first name after the dedicated question", () => {
    expect(preferredFirstNameReply("  brad  ")).toBe("Brad");
    expect(preferredFirstNameReply("Brad Dicks")).toBeNull();
    expect(preferredFirstNameReply("yes")).toBeNull();
    expect(preferredFirstNameReply("I need windows")).toBeNull();
  });

  it("uses the name naturally at selected milestones without forcing it into every message", () => {
    expect(personaliseOpening("Perfect — your request is live.", "Brian", true))
      .toBe("Perfect, Brian — your request is live.");
    expect(personaliseOpening("What postcode is the job for?", "Brian", true))
      .toBe("Thanks, Brian. What postcode is the job for?");
    expect(personaliseOpening("What postcode is the job for?", "Brian", false))
      .toBe("What postcode is the job for?");
  });
});
