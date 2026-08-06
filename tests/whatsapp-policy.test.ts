import { describe, expect, it } from "vitest";
import {
  attachmentInterpretation,
  earliestInboundAt,
  firstContactConsentReply,
  isCancelAllDraftsRequest,
  isCancelDraftRequest,
  isConversationOptOut,
  isMenuRequest,
  isNewQuoteRequest,
  isQuoteConfirmation,
  newQuoteDetails,
  isQuoteHistoryRequest,
  isQuoteRefresh,
  isServiceWindowOpen,
  RECENT_REPLY_DEDUPE_MS,
  quoteMenu,
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

  it("separates menu, new quote and quote history commands", () => {
    expect(["hello", "MENU", " help "].every(isMenuRequest)).toBe(true);
    expect(["1", "new", "NEW QUOTE", "start new quote", "separate quote", "another job"].every(isNewQuoteRequest)).toBe(true);
    expect(["2", "MY QUOTES", "past quotes", "history"].every(isQuoteHistoryRequest)).toBe(true);
    expect(isNewQuoteRequest("five new windows")).toBe(false);
    expect(isQuoteHistoryRequest("quotes")).toBe(false);
  });

  it("separates draft cancellation from closing the WhatsApp conversation", () => {
    expect(["3", "cancel", "CANCEL DRAFT", "cancel current quote", "start again", "reset job"].every(isCancelDraftRequest)).toBe(true);
    expect(["CANCEL ALL DRAFTS", "clear all quote drafts", "delete all current jobs"].every(isCancelAllDraftsRequest)).toBe(true);
    expect(["STOP", "unsubscribe", "close conversation"].every(isConversationOptOut)).toBe(true);
    expect(isConversationOptOut("cancel")).toBe(false);
    expect(isCancelDraftRequest("cancel all drafts")).toBe(false);
    expect(isCancelAllDraftsRequest("cancel draft")).toBe(false);
  });

  it("keeps product details when a customer starts another job", () => {
    expect(isNewQuoteRequest("another quote for aluminium bifolds")).toBe(true);
    expect(newQuoteDetails("another quote for aluminium bifolds")).toBe("aluminium bifolds");
    expect(newQuoteDetails("I need a separate job: 3 uPVC windows")).toBe("3 uPVC windows");
    expect(newQuoteDetails("NEW QUOTE")).toBeNull();
  });

  it("offers a warm two-choice menu and explains file support", () => {
    const menu = quoteMenu(true);
    expect(menu).toContain("industry partner");
    expect(menu).toContain("1 — NEW QUOTE");
    expect(menu).toContain("2 — MY QUOTES");
    expect(menu).toContain("3 — CANCEL DRAFT");
    expect(menu).toContain("photo, drawing or PDF");
    expect(menu).toContain("One unsent draft is open");
    expect(menu).toContain("Confirmed requests stay safe");
  });

  it("guides a first-time customer without requiring a special opening phrase", () => {
    const reply = firstContactConsentReply({
      privacyUrl: "https://bridge-ai.example/legal/privacy",
      hasMedia: true,
      hasText: false,
    });
    expect(reply).toContain("say “Hi”");
    expect(reply).toContain("Can I have a quote please?");
    expect(reply).toContain("photo, drawing or PDF");
    expect(reply).toContain("securely received your file");
    expect(reply).toContain("won’t analyse it until you choose to continue");
    expect(reply).toContain("Reply CONTINUE");
  });

  it("keeps the customer's first message inside the quote session after consent", () => {
    const firstPhotoAt = new Date("2026-08-05T11:55:00.000Z");
    expect(earliestInboundAt([
      { direction: "INBOUND", occurredAt: firstPhotoAt },
      { direction: "OUTBOUND", occurredAt: new Date("2026-08-05T11:56:00.000Z") },
      { direction: "INBOUND", occurredAt: now },
    ], now)).toEqual(firstPhotoAt);
  });

  it("accepts a natural yes only as an explicit quote confirmation", () => {
    expect(["YES", "yes please", "That's right", "correct", "go ahead", "send it"].every(isQuoteConfirmation)).toBe(true);
    expect(isQuoteConfirmation("maybe")).toBe(false);
    expect(isQuoteConfirmation("yes, but change the colour")).toBe(false);
  });

  it("turns attachment analysis into a cautious customer-facing interpretation", () => {
    const reply = attachmentInterpretation(["six window elevations with handwritten dimensions."]);
    expect(reply).toContain("My reading is: six window elevations");
    expect(reply).toContain("If I’ve misunderstood anything");
  });
});
