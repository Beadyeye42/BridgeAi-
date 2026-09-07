export type RecoveryHashSession = {
  accessToken: string;
  refreshToken: string;
};

export function recoverySessionFromHash(hash: string): RecoveryHashSession | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const type = params.get("type");
  if (type !== "recovery" && type !== "invite") return null;

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return null;

  return { accessToken, refreshToken };
}

export function safeAuthNextPath(value: string | null, fallback = "/dashboard") {
  // URL parsers treat backslashes as slashes and strip control characters.
  // Reject both before a callback resolves this path against the app origin.
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  const base = "https://bridge-it.invalid";
  try {
    const url = new URL(value, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
