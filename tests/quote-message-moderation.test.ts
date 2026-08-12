import { describe, expect, it } from "vitest";
import { moderatePreSelectionQuoteMessage } from "../lib/quotes/message-moderation";

describe("pre-selection quote message moderation", () => {
  it("allows legitimate specification and delivery questions", () => {
    expect(moderatePreSelectionQuoteMessage("Can you supply anthracite grey and deliver by Friday?")).toEqual({ allowed: true, reasons: [] });
  });

  it("blocks contact details and attempts to move the conversation elsewhere", () => {
    expect(moderatePreSelectionQuoteMessage("Call me on 07700 900123").allowed).toBe(false);
    expect(moderatePreSelectionQuoteMessage("Email sales@example.co.uk").allowed).toBe(false);
    expect(moderatePreSelectionQuoteMessage("Message @supplier on WhatsApp").allowed).toBe(false);
    expect(moderatePreSelectionQuoteMessage("See https://example.com").allowed).toBe(false);
  });
});
