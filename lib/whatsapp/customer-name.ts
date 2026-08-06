const companyProfilePattern = /\b(?:ltd|limited|llp|plc|group|holdings?|windows?|doors?|glazing|glass|trade|building|builders?|construction|supplies|roofing|joinery|business|company|installations?|services?)\b|[&@]|\d/i;
const nonNameWords = new Set([
  "agree", "aluminium", "bifold", "cancel", "composite", "confirm", "continue",
  "door", "doors", "hello", "help", "hi", "looking", "new", "no", "patio",
  "pdf", "photo", "quote", "quotes", "roof", "timber", "upvc", "window", "windows", "yes",
]);

function tidyFirstName(value: string) {
  const tidy = value.trim().replace(/[.!?,:;]+$/g, "");
  if (!/^[\p{L}][\p{L}\p{M}'’-]{0,38}[\p{L}]$/u.test(tidy)) return null;
  if (nonNameWords.has(tidy.toLocaleLowerCase("en-GB"))) return null;
  if (tidy === tidy.toLocaleUpperCase("en-GB") || tidy === tidy.toLocaleLowerCase("en-GB")) {
    const lower = tidy.toLocaleLowerCase("en-GB");
    return lower.charAt(0).toLocaleUpperCase("en-GB") + lower.slice(1);
  }
  return tidy;
}

export function profileFirstName(displayName: string | null | undefined) {
  const tidy = displayName?.trim().replace(/\s+/g, " ");
  if (!tidy || tidy.length > 80 || companyProfilePattern.test(tidy)) return null;
  const words = tidy.split(" ");
  if (words.length > 4 || words.some((word) => !tidyFirstName(word))) return null;
  return tidyFirstName(words[0]);
}

export function explicitPreferredFirstName(message: string) {
  const tidy = message.trim();
  const match = /^(?:please\s+)?(?:call me|my (?:first )?name is)\s+([\p{L}][\p{L}\p{M}'’-]{0,39})[.!]?$/iu.exec(tidy)
    ?? /^(?:i am|i['’]?m|im)\s+([\p{L}][\p{L}\p{M}'’-]{0,39})[.!]?$/iu.exec(tidy);
  return match ? tidyFirstName(match[1]) : null;
}

export function preferredFirstNameReply(message: string) {
  return tidyFirstName(message.trim());
}

export function personaliseOpening(message: string, firstName: string | null, useName: boolean) {
  if (!firstName || !useName) return message;
  if (/^great\b/i.test(message)) return message.replace(/^great\b/i, `Great, ${firstName}`);
  if (/^perfect\b/i.test(message)) return message.replace(/^perfect\b/i, `Perfect, ${firstName}`);
  return `Thanks, ${firstName}. ${message}`;
}
