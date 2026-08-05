import { describe, expect, it } from "vitest";
import {
  isQuoteRefresh,
  isServiceWindowOpen,
  RECENT_REPLY_DEDUPE_MS,
  wasReplyRecentlySent,
  WHATSAPP_SERVICE_WINDOW_MS,
} from "../lib/whatsapp/policy";

describe("WhatsApp messaging policy", () => {
  const now = new Date("2026-08-05T12:00:00.000Z");

  it("keeps the free service window open for 24 hours after the latest customer message", () => {
    expect(isServiceWindowOpen([
      { direction: "INBOUND", occurredAt: new Date(now.getTime() - WHATSAPP_SERVICE_WINDOW_MS + 1) },
    ], now)).toBe(true);
    expect(isServiceWindowOpen([
      { direction: "INBOUND", occurredAt: new Date(now.getTime() - WHATSAPP_SERVICE_WINDOW_MS) },
    ], now)).toBe(false);
  });

  it("resets the service window whenever the customer sends another message", () => {
    expect(isServiceWindowOpen([
      { direction: "INBOUND", occurredAt: new Date(now.getTime() - 48 * 60 * 60_000) },
      { direction: "OUTBOUND", occurredAt: new Date(now.getTime() - 30 * 60_000) },
      { direction: "INBOUND", occurredAt: new Date(now.getTime() - 60_000) },
    ], now)).toBe(true);
  });

  it("suppresses only an identical successful reply inside the short dedupe window", () => {
    const sentAt = new Date(now.getTime() - RECENT_REPLY_DEDUPE_MS + 1);
    expect(wasReplyRecentlySent([
      { direction: "OUTBOUND", status: "SENT", occurredAt: sentAt, body: "One clear reply" },
    ], "One clear reply", now)).toBe(true);
    expect(wasReplyRecentlySent([
      { direction: "OUTBOUND", status: "FAILED", occurredAt: sentAt, body: "One clear reply" },
    ], "One clear reply", now)).toBe(false);
    expect(wasReplyRecentlySent([
      { direction: "OUTBOUND", status: "SENT", occurredAt: sentAt, body: "A different reply" },
    ], "One clear reply", now)).toBe(false);
  });

  it("recognises concise customer requests for the latest quote list", () => {
    expect(["quote", "QUOTES", " update ", "status"].every(isQuoteRefresh)).toBe(true);
    expect(isQuoteRefresh("accept 1")).toBe(false);
  });
});
