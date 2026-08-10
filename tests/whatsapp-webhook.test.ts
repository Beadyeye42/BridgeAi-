import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  metaEventDigest,
  parseMetaWebhook,
  verifyMetaSignature,
  verifyMetaToken,
} from "../lib/whatsapp/webhook";

const fixture = {
  object: "whatsapp_business_account",
  entry: [{
    id: "waba-123",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        contacts: [{ wa_id: "447700900142", profile: { name: "Private Customer" } }],
        messages: [{
          from: "447700900142",
          id: "wamid.message-1",
          timestamp: "1785751200",
          type: "text",
          text: { body: "Please quote this private enquiry" },
        }],
        statuses: [{ id: "wamid.outbound-1", status: "delivered", timestamp: "1785751201" }],
      },
    }],
  }],
};

describe("Meta WhatsApp webhook boundary", () => {
  it("uses exact constant-time token and HMAC verification", () => {
    const bytes = Buffer.from(JSON.stringify(fixture));
    const secret = "test-app-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(bytes).digest("hex")}`;
    expect(verifyMetaToken("expected", "expected")).toBe(true);
    expect(verifyMetaToken("wrong", "expected")).toBe(false);
    expect(verifyMetaSignature(bytes, signature, secret)).toBe(true);
    expect(verifyMetaSignature(bytes, signature, "wrong-secret")).toBe(false);
    expect(verifyMetaSignature(bytes, "sha1=bad", secret)).toBe(false);
  });

  it("extracts bounded operations while keeping the persisted summary PII-free", () => {
    const parsed = parseMetaWebhook(fixture);
    expect(parsed.messages[0]).toMatchObject({
      externalMessageId: "wamid.message-1",
      from: "447700900142",
      displayName: "Private Customer",
      body: "Please quote this private enquiry",
      messageType: "TEXT",
    });
    expect(parsed.statuses[0]).toMatchObject({ status: "DELIVERED", externalMessageId: "wamid.outbound-1" });
    const persistedSummary = JSON.stringify(parsed.summary);
    expect(persistedSummary).not.toContain("447700900142");
    expect(persistedSummary).not.toContain("Private Customer");
    expect(persistedSummary).not.toContain("private enquiry");
  });

  it("rejects the wrong product and invalid sender identifiers", () => {
    expect(() => parseMetaWebhook({ ...fixture, object: "page" })).toThrow();
    const invalid = structuredClone(fixture);
    invalid.entry[0].changes[0].value.messages[0].from = "+44 private";
    expect(() => parseMetaWebhook(invalid)).toThrow();
  });

  it("derives a stable idempotency digest from the exact request bytes", () => {
    const bytes = Buffer.from(JSON.stringify(fixture));
    expect(metaEventDigest(bytes)).toBe(metaEventDigest(bytes));
    expect(metaEventDigest(bytes)).not.toBe(metaEventDigest(Buffer.from("different")));
  });

  it("extracts private media references without placing them in persisted event summaries", () => {
    const media = structuredClone(fixture);
    media.entry[0].changes[0].value.messages[0] = {
      from: "447700900142",
      id: "wamid.media-1",
      timestamp: "1785751200",
      type: "document",
      document: { id: "media-private-1", mime_type: "application/pdf", filename: "drawing.pdf", caption: "Fabrication drawing" },
    } as never;
    const parsed = parseMetaWebhook(media);
    expect(parsed.messages[0]).toMatchObject({
      mediaId: "media-private-1",
      mediaMimeType: "application/pdf",
      mediaFileName: "drawing.pdf",
      messageType: "DOCUMENT",
    });
    expect(JSON.stringify(parsed.summary)).not.toContain("drawing.pdf");
    expect(JSON.stringify(parsed.summary)).not.toContain("Fabrication drawing");
  });

  it("turns interactive confirmations into the visible reply text", () => {
    const interactive = structuredClone(fixture);
    interactive.entry[0].changes[0].value.messages[0] = {
      from: "447700900142",
      id: "wamid.interactive-1",
      timestamp: "1785751200",
      type: "interactive",
      interactive: {
        type: "button_reply",
        button_reply: { id: "confirm-quote", title: "Confirm quote" },
      },
    } as never;
    expect(parseMetaWebhook(interactive).messages[0]).toMatchObject({
      messageType: "INTERACTIVE",
      body: "Confirm quote",
    });
  });
});
