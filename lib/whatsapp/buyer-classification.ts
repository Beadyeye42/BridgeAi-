export type BuyerTypeValue = "CONSUMER" | "TRADE" | "BUSINESS";

const explicitConsumer = /\b(?:personal|personally|homeowner|for myself|my home|my house|my flat|my sofa|this sofa|my furniture|my car)\b/i;
const explicitTrade = /\b(?:trade|tradesperson|installer|builder|contractor|my customer|my client|customer(?:'s)? job|client(?:'s)? job|on site|job site)\b/i;
const explicitBusiness = /\b(?:business|company|commercial|organisation|organization|facilities|warehouse|office|our stock|stock transfer|our premises|pallets?)\b/i;

export function classifyBuyerType(text: string): BuyerTypeValue | null {
  const normalized = text.trim();
  if (/^(?:1|personal|consumer|homeowner|for me)$/i.test(normalized)) return "CONSUMER";
  if (/^(?:2|trade|tradesperson|installer|builder)$/i.test(normalized)) return "TRADE";
  if (/^(?:3|business|company|commercial)$/i.test(normalized)) return "BUSINESS";
  const matches = [
    explicitConsumer.test(normalized) ? "CONSUMER" as const : null,
    explicitTrade.test(normalized) ? "TRADE" as const : null,
    explicitBusiness.test(normalized) ? "BUSINESS" as const : null,
  ].filter((value): value is BuyerTypeValue => value !== null);
  return new Set(matches).size === 1 ? matches[0] : null;
}

export function buyerTypeLabel(value: BuyerTypeValue) {
  if (value === "CONSUMER") return "Consumer / homeowner";
  if (value === "TRADE") return "Trade buyer";
  return "Business buyer";
}

export function intentQualityLabel(value: "BROWSING" | "QUALIFIED" | "URGENT" | "READY_TO_BUY") {
  if (value === "BROWSING") return "Browsing";
  if (value === "QUALIFIED") return "Qualified";
  if (value === "URGENT") return "Urgent";
  return "Ready to buy";
}

export function buyerTypeAllowed(
  value: BuyerTypeValue,
  settings: { servesConsumer?: boolean; servesTrade?: boolean; servesBusiness?: boolean },
) {
  if (value === "CONSUMER") return settings.servesConsumer === true;
  if (value === "TRADE") return settings.servesTrade !== false;
  return settings.servesBusiness !== false;
}
