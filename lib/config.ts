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
