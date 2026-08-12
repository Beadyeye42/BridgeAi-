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

type FirstContactReplyInput = {
  privacyUrl: string;
  hasMedia: boolean;
  hasText: boolean;
};

export function earliestInboundAt(messages: WindowMessage[], fallback: Date) {
  return messages
    .filter((message) => message.direction === "INBOUND")
    .reduce(
      (earliest, message) => message.occurredAt < earliest ? message.occurredAt : earliest,
      fallback,
    );
}

export function firstContactConsentReply(input: FirstContactReplyInput) {
  const received = input.hasMedia
    ? "I’ve securely received your file. I’ll keep it safe, but I won’t analyse it until you choose to continue."
    : input.hasText
      ? "I’ve securely received what you sent. I’ll keep it safe, but I won’t analyse it until you choose to continue."
      : null;
  return [
    "Hi 👋 I’m Bridge-iT, your quotation assistant from Ironbridge Group Ltd.",
    "What do you need? Bridge it. Send me a message, photo, drawing or document, and tell me where and when you need it.",
    received,
    "I’ll identify the right specialist category behind the scenes, turn the useful details into a clear request for approved suppliers, then bring their prices and lead times back here.",
    "Clear photos, surveys, drawings, schedules and PDFs usually lead to faster, more confident supplier quotes.",
    "Your contact details stay private until you accept a quote and the selected supplier completes the secure contact unlock.",
    `Privacy: ${input.privacyUrl}`,
    "Reply CONTINUE to let Bridge-iT use automated processing for this enquiry, or STOP to end.",
  ].filter(Boolean).join("\n\n");
}

export function isQuoteConfirmation(value: string) {
  const reply = value.trim().replace(/\s+/g, " ").replace(/[.!?]+$/g, "").trim();
  return /^(?:confirm(?: (?:it|this|quote|request))?|yes(?: please)?|yes and confirm(?: it)?|yep|correct|yes,? (?:that(?:'s| is) right|correct)|that(?:'s| is) right|looks right|go ahead|send it)(?:\s*[👍✅])?$/iu.test(reply);
}

export function isIndustryQuoteOfferAccepted(value: string) {
  return /^(?:yes|yes please|yep|yeah|sure|absolutely|ok|okay|please do|go ahead|sounds good|(?:yes,? )?(?:that would|that'd) be (?:great|good|helpful)|find (?:me|us) (?:a )?quote|get (?:me|us) (?:a )?quote|quote please)$/i.test(value.trim());
}

export function isIndustryQuoteOfferDeclined(value: string) {
  return /^(?:no|nope|no thanks|no thank you|not now|not today|maybe later|just asking|information only)$/i.test(value.trim());
}

export function industryQuoteOfferReply(helpfulAnswer: string) {
  const answer = helpfulAnswer
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900)
    .replace(/\s*(?:would you like|shall I|can I)\b[\s\S]*$/i, "")
    .trim();
  return [
    answer || "I can help with that.",
    "Would you like me to find you a competitive quote from trusted, approved suppliers? Reply YES and I’ll get the right details together.",
  ].join("\n\n");
}

export function attachmentInterpretation(summaries: string[]) {
  const safe = summaries
    .map((summary) => summary.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 320))
    .filter(Boolean);
  if (!safe.length) return null;
  const evidence = safe.length === 1 ? safe[0] : safe.map((summary) => `• ${summary}`).join("\n");
  return safe.length === 1
    ? `I’ve checked the file. My reading is: ${evidence.replace(/[.!?]+$/, "")}. If I’ve misunderstood anything, tell me and I’ll correct it.`
    : `I’ve checked the files. My reading is:\n${evidence}\nIf I’ve misunderstood anything, tell me and I’ll correct it.`;
}

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

export type QuoteSelectionIntent =
  | { kind: "CURRENT" }
  | { kind: "POSITION"; position: number }
  | { kind: "LABEL"; label: string }
  | { kind: "REFERENCE"; reference: string };

export function quoteSelectionIntent(value: string): QuoteSelectionIntent | null {
  const trimmed = value.trim();
  const position = /^(?:(?:accept|choose|select|take)(?:\s+(?:quote|option))?|quote|option)?\s*([1-5])$/i.exec(trimmed);
  if (position) return { kind: "POSITION", position: Number(position[1]) };

  const label = /^(?:(?:accept|choose|select|take|go with)(?:\s+(?:quote|option))?|quote|option)?\s*([A-E])$/i.exec(trimmed);
  if (label) return { kind: "LABEL", label: label[1].toUpperCase() };

  const reference = /^(?:accept|choose|select|take)(?:\s+(?:quote|option))?\s+(BA-\d{4}-[A-Z0-9]+)$/i.exec(trimmed);
  if (reference) return { kind: "REFERENCE", reference: reference[1].toUpperCase() };

  if (/^(?:accept|accept (?:it|quote)|yes|yes please|choose it|select it|take it|go (?:with|for) it)$/i.test(trimmed)) {
    return { kind: "CURRENT" };
  }
  return null;
}

export type QuoteQuestionIntent =
  | { kind: "ONE"; label: string; question: string }
  | { kind: "ALL"; question: string };

export function quoteQuestionIntent(value: string): QuoteQuestionIntent | null {
  const trimmed = value.trim().replace(/\s+/g, " ");
  const all = /^(?:ask|question)\s+(?:all|everyone|all quotes?|all suppliers?)\s*(?:[:,-]\s*|\s+)(.+)$/i.exec(trimmed);
  if (all?.[1]?.trim()) return { kind: "ALL", question: all[1].trim() };

  const one = /^(?:ask|question)\s+(?:(?:quote|option|supplier)\s*)?([A-E])\s*(?:[:,-]\s*|\s+)(.+)$/i.exec(trimmed);
  if (one?.[1] && one[2]?.trim()) {
    return { kind: "ONE", label: one[1].toUpperCase(), question: one[2].trim() };
  }
  return null;
}

export function isConversationOptOut(value: string) {
  return /^(stop|end|unsubscribe|close conversation)$/i.test(value.trim());
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

export function isCancelAllDraftsRequest(value: string) {
  return /^(?:cancel|clear|delete|discard|remove)\s+(?:(?:all|my)\s+)*(?:current\s+)?(?:(?:quote|job)\s+)?drafts$/i.test(value.trim())
    || /^(?:cancel|clear|delete|discard|remove)\s+all\s+(?:current\s+)?(?:(?:quote|job)\s+)?draft$/i.test(value.trim())
    || /^(?:cancel|clear|delete|discard|remove)\s+all\s+(?:current\s+)?(?:quotes?|jobs?)$/i.test(value.trim());
}

export function isCancelDraftRequest(value: string) {
  if (isCancelAllDraftsRequest(value)) return false;
  return /^(?:3|cancel|(?:cancel|clear|delete|discard|remove) (?:current )?(?:(?:quote|job) )?draft|cancel (?:current )?(?:quote|job)|start again|start over|reset (?:current )?(?:quote|job|draft))$/i.test(value.trim());
}

export function isMenuRequest(value: string) {
  return /^(hi|hello|hey|menu|help|start)$/i.test(value.trim());
}

export function isConversationalHelpRequest(value: string) {
  const normalised = value
    .trim()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
  return /^(?:(?:hi|hello|hey)(?: bridge(?: ai|-?it))?[, ]*)?(?:can|could|would) you help(?: me)?(?: (?:find|get)(?: me| us)?| with)?(?: a)? quote(?: please)?$/i.test(normalised)
    || /^(?:(?:hi|hello|hey)(?: bridge(?: ai|-?it))?[, ]*)?i need help (?:finding|getting|with) (?:a )?quote(?: please)?$/i.test(normalised)
    || /^(?:can you help me|please help me|i need some help)$/i.test(normalised);
}

export function conversationPivotContext<T extends { direction: "INBOUND" | "OUTBOUND"; text: string }>(
  messages: T[],
  latestText: string,
) {
  const latestInboundIndex = messages.findLastIndex(
    (message) => message.direction === "INBOUND" && message.text === latestText,
  );
  if (latestInboundIndex < 0) return [{ direction: "INBOUND" as const, text: latestText }];
  const recentStart = Math.max(0, latestInboundIndex - 8);
  const helpIndex = messages.findLastIndex(
    (message, index) => index >= recentStart
      && index < latestInboundIndex
      && message.direction === "INBOUND"
      && isConversationalHelpRequest(message.text),
  );
  return messages.slice(helpIndex >= 0 ? helpIndex : latestInboundIndex);
}

export function quoteMenu(hasDraft = false) {
  return [
    "Hi 👋 I’m Bridge-iT — your industry partner for finding competitive prices and lead times from approved suppliers.",
    "What do you need? Bridge it.",
    "1 — BRIDGE A REQUEST\nStart a fresh job, including a separate job for another customer.",
    "2 — MY QUOTES\nCheck your recent requests.",
    "3 — CANCEL DRAFT\nClear the unfinished job and start again. Confirmed requests stay safe.",
    "Send a message, photo, drawing or document. Include where and when you need it if you can; I’ll identify the right specialist category behind the scenes.",
    hasDraft ? "One unsent draft is open. Continue describing it, reply YES when the summary is right, or reply CANCEL DRAFT to clear it." : "There is no unfinished draft open.",
  ].filter(Boolean).join("\n\n");
}
