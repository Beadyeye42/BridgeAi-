const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?:\+?44\s?\d|0\d)(?:[\s().-]*\d){8,12}/;
const URL = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|co\.uk|uk|net|org)\b)/i;
const SOCIAL = /\b(?:whats\s*app|instagram|facebook|linkedin|telegram|signal)\b|@[a-z0-9_.]{3,}/i;
const ADDRESS = /\b\d{1,5}\s+[a-z][a-z\s'-]{2,}\s(?:road|rd|street|st|lane|ln|avenue|ave|close|drive|way|court|place|crescent)\b/i;

export type ModerationResult = { allowed: true; reasons: [] } | { allowed: false; reasons: string[] };

export function moderatePreSelectionQuoteMessage(value: string): ModerationResult {
  const text = value.trim();
  const reasons: string[] = [];
  if (EMAIL.test(text)) reasons.push("EMAIL_ADDRESS");
  if (PHONE.test(text)) reasons.push("PHONE_NUMBER");
  if (URL.test(text)) reasons.push("WEB_LINK");
  if (SOCIAL.test(text)) reasons.push("SOCIAL_OR_MESSAGING_HANDLE");
  if (ADDRESS.test(text)) reasons.push("STREET_ADDRESS");
  return reasons.length ? { allowed: false, reasons: [...new Set(reasons)] } : { allowed: true, reasons: [] };
}
