export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60_000;
export const RECENT_REPLY_DEDUPE_MS = 5 * 60_000;

type WindowMessage = {
  direction: "INBOUND" | "OUTBOUND";
  occurredAt: Date;
};

type ReplyMessage = WindowMessage & {
  status: string;
  body?: string | null;
};

export function isServiceWindowOpen(messages: WindowMessage[], now = new Date()) {
  const lastInboundAt = messages
    .filter((message) => message.direction === "INBOUND")
    .reduce<Date | null>(
      (latest, message) => !latest || message.occurredAt > latest ? message.occurredAt : latest,
      null,
    );
  return Boolean(lastInboundAt && now.getTime() - lastInboundAt.getTime() < WHATSAPP_SERVICE_WINDOW_MS);
}

export function wasReplyRecentlySent(messages: ReplyMessage[], body: string, now = new Date()) {
  return messages.some((message) => message.direction === "OUTBOUND"
    && ["SENT", "DELIVERED", "READ"].includes(message.status)
    && message.body === body
    && now.getTime() - message.occurredAt.getTime() < RECENT_REPLY_DEDUPE_MS);
}

export function isQuoteRefresh(value: string) {
  return /^(quotes?|update|status)$/i.test(value.trim());
}

export function newQuoteDetails(value: string) {
  const trimmed = value.trim();
  const match = /^(?:i\s+(?:need|want|would\s+like)\s+)?(?:a\s+)?(?:new|another|separate|different)\s+(?:quote|job)(?:\s+(?:for|about)\s+|\s*[:\-]\s*|\s+)(.+)$/i.exec(trimmed);
  const details = match?.[1]?.trim();
  return details && details.length > 1 ? details : null;
}

export function isNewQuoteRequest(value: string) {
  return /^(?:1|new|new quote|new job|start (?:a )?new (?:quote|job)|create (?:a )?new (?:quote|job)|another quote|another job|separate quote|separate job|different quote|different job)$/i.test(value.trim())
    || newQuoteDetails(value) !== null;
}

export function isQuoteHistoryRequest(value: string) {
  return /^(?:2|my quotes?|past quotes?|quote history|previous quotes?|history)$/i.test(value.trim());
}

export function isMenuRequest(value: string) {
  return /^(hi|hello|hey|menu|help|start)$/i.test(value.trim());
}

export function quoteMenu(hasDraft = false) {
  return [
    "Hi 👋 I’m Bridge AI — your industry partner for finding competitive prices and lead times from approved suppliers.",
    "1 — NEW QUOTE\nStart a fresh job, including a separate job for another customer.",
    "2 — MY QUOTES\nCheck your recent requests.",
    "You can type the product you need or send a photo, drawing or PDF.",
    hasDraft ? "Your unsent draft is still safe. Continue describing it, or reply CONFIRM when the summary is right." : null,
  ].filter(Boolean).join("\n\n");
}
