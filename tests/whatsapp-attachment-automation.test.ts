import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attachmentAutomationDecision } from "../lib/whatsapp/attachment-policy";

describe("WhatsApp attachment automation", () => {
  it("continues with a useful trade file even when a legacy analysis requested review", () => {
    expect(attachmentAutomationDecision({ usefulForQuote: true, needsHumanReview: true }))
      .toEqual({ action: "USE_FOR_QUOTE" });
  });

  it("automatically excludes an unusable file without blocking intake", () => {
    expect(attachmentAutomationDecision({ usefulForQuote: false, needsHumanReview: true }))
      .toEqual({ action: "EXCLUDE_AND_CONTINUE" });
    expect(attachmentAutomationDecision({ usefulForQuote: false, needsHumanReview: false }))
      .toEqual({ action: "EXCLUDE_AND_CONTINUE" });
  });

  it("does not send customers into an administrator-review loop for attachments", () => {
    const source = readFileSync(new URL("../lib/whatsapp/processor.ts", import.meta.url), "utf8");
    expect(source).not.toContain("needs a Bridge AI administrator to review it before the quote request can continue");
    expect(source).not.toContain("CUSTOMER_ATTACHMENT_REVIEW");
    expect(source).toContain("WHATSAPP.MEDIA_EXCLUDED_AUTOMATICALLY");
  });
});
