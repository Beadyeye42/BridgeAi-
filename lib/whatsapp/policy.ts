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

export function isNewQuoteRequest(value: string) {
  return /^(new|new quote|start new quote|create (?:a )?new quote)$/i.test(value.trim());
}

export function isQuoteHistoryRequest(value: string) {
  return /^(my quotes?|past quotes?|quote history|previous quotes?|history)$/i.test(value.trim());
}

export function isMenuRequest(value: string) {
  return /^(hi|hello|hey|menu|help|start)$/i.test(value.trim());
}

export function quoteMenu(hasDraft = false) {
  return [
    "Welcome to Bridge AI. What would you like to do?",
    "Reply NEW QUOTE to start a fresh request.",
    "Reply MY QUOTES to check your recent requests.",
    hasDraft ? "Your unsent draft is still saved. You can also continue describing it, or reply CONFIRM when it is ready." : null,
  ].filter(Boolean).join("\n\n");
}
