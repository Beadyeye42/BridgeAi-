import "server-only";

function configuredUrl(name: string, value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production`);
  }
  return url.origin;
}

export function applicationOrigin(requestUrl: string) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configuredUrl("APP_URL", configured);
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL is required in production");
  }
  return new URL(requestUrl).origin;
}

export function metaWebhookCredentials() {
  const verifyToken = process.env.META_WHATSAPP_VERIFY_TOKEN?.trim();
  const appSecret = process.env.META_WHATSAPP_APP_SECRET?.trim();
  if (!verifyToken || !appSecret) {
    throw new Error("Meta WhatsApp webhook credentials are not configured");
  }
  return { verifyToken, appSecret };
}

export function metaMessagingCredentials() {
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim();
  const graphApiVersion = process.env.META_GRAPH_API_VERSION?.trim() || "v26.0";
  if (!accessToken || !phoneNumberId) {
    throw new Error("Meta WhatsApp messaging credentials are not configured");
  }
  if (!/^\d{5,32}$/.test(phoneNumberId)) throw new Error("META_WHATSAPP_PHONE_NUMBER_ID is invalid");
  if (!/^v\d+\.\d+$/.test(graphApiVersion)) throw new Error("META_GRAPH_API_VERSION is invalid");
  return { accessToken, phoneNumberId, graphApiVersion };
}

export function metaQuoteTemplate() {
  const name = process.env.META_WHATSAPP_QUOTE_TEMPLATE_NAME?.trim();
  if (!name) return null;
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new Error("META_WHATSAPP_QUOTE_TEMPLATE_NAME is invalid");
  const language = process.env.META_WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en_GB";
  if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)) throw new Error("META_WHATSAPP_TEMPLATE_LANGUAGE is invalid");
  return { name, language };
}

export function metaContactTemplate() {
  const name = process.env.META_WHATSAPP_CONTACT_TEMPLATE_NAME?.trim();
  if (!name) return null;
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new Error("META_WHATSAPP_CONTACT_TEMPLATE_NAME is invalid");
  const language = process.env.META_WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en_GB";
  if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)) throw new Error("META_WHATSAPP_TEMPLATE_LANGUAGE is invalid");
  return { name, language };
}

export function metaBuyerLoginTemplate() {
  const name = process.env.META_WHATSAPP_BUYER_LOGIN_TEMPLATE_NAME?.trim();
  if (!name) return null;
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new Error("META_WHATSAPP_BUYER_LOGIN_TEMPLATE_NAME is invalid");
  const language = process.env.META_WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en_GB";
  if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)) throw new Error("META_WHATSAPP_TEMPLATE_LANGUAGE is invalid");
  return { name, language };
}

export function whatsappMessagingPolicy() {
  const raw = process.env.WHATSAPP_ALLOW_PAID_TEMPLATES?.trim().toLowerCase();
  if (raw && raw !== "true" && raw !== "false") {
    throw new Error("WHATSAPP_ALLOW_PAID_TEMPLATES must be true or false");
  }
  return { allowPaidTemplates: raw === "true" };
}

export function openAiCredentials() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OpenAI API credentials are not configured");
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.6";
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(model)
      || /(?:^|[-_:])(terra|sol|codex)(?:$|[-_:])/i.test(model)) {
    throw new Error("OPENAI_MODEL_INVALID");
  }
  return { apiKey, model };
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function whatsappConciergeConfig() {
  return {
    quoteResponseHours: boundedInteger("QUOTE_RESPONSE_HOURS", 48, 1, 336),
    distributionLimit: boundedInteger("DEFAULT_QUOTE_DISTRIBUTION_LIMIT", 5, 1, 5),
  };
}

export function buyerRewardsConfig() {
  return {
    completionPoints: boundedInteger("BUYER_REWARD_COMPLETION_POINTS", 100, 1, 1000),
  };
}
