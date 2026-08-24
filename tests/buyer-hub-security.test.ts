import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeBuyerPhone } from "../lib/buyer/auth";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Buyer Hub security and ownership controls", () => {
  it("normalises UK WhatsApp numbers without accepting malformed input", () => {
    expect(normalizeBuyerPhone("07700 900123")).toBe("447700900123");
    expect(normalizeBuyerPhone("+44 7700 900123")).toBe("447700900123");
    expect(normalizeBuyerPhone("0044 7700 900123")).toBe("447700900123");
    expect(normalizeBuyerPhone("123")).toBeNull();
    expect(normalizeBuyerPhone("+44 7700 900123 999999")).toBeNull();
  });

  it("uses neutral login responses and never stores the raw WhatsApp link token", () => {
    const auth = read("lib/buyer/auth.ts");
    const route = read("app/api/buyer/auth/request-link/route.ts");
    const verifier = read("components/buyer/buyer-auth-verifier.tsx");
    const migration = read("supabase/migrations/20260824170900_buyer_hub_passwordless_orders_rewards.sql");
    expect(route).toContain("BUYER_LOGIN_NEUTRAL_MESSAGE");
    expect(route).toContain("status: 202");
    expect(route).toContain("after(async");
    expect(auth).toContain("tokenDigest: digest(tokenHash)");
    expect(auth).toContain("url.hash = new URLSearchParams");
    expect(auth).not.toContain('url.searchParams.set("token_hash"');
    expect(verifier).toContain('window.history.replaceState(null, "", window.location.pathname)');
    expect(migration).toContain('"tokenDigest" varchar(64)');
    expect(migration).not.toContain('"tokenHash"');
  });

  it("binds the thirty-day trusted device to a verified Supabase session ID", () => {
    const session = read("lib/buyer/session.ts");
    const verifyRoute = read("app/api/buyer/auth/verify/route.ts");
    const verified = read("lib/supabase/verified-user.ts");
    const migration = read("supabase/migrations/20260824170900_buyer_hub_passwordless_orders_rewards.sql");
    expect(verified).toContain("supabase.auth.getClaims()");
    expect(verified).toContain("claims?.session_id");
    expect(verifyRoute).toContain("registerBuyerTrustedSession");
    expect(verifyRoute).toContain("supabase.auth.verifyOtp");
    expect(session).toContain("sessionId: auth.sessionId");
    expect(session).toContain("revokedAt: null");
    expect(session).toContain("expiresAt: { gt: now }");
    expect(migration).toContain('CREATE TABLE bridge_ai."BuyerTrustedSession"');
    expect(migration).toContain('ALTER TABLE bridge_ai."BuyerTrustedSession" FORCE ROW LEVEL SECURITY');
  });

  it("revokes device grants on logout and buyer suspension", () => {
    const logout = read("app/api/buyer/auth/logout/route.ts");
    const suspension = read("app/api/admin/buyers/[id]/status/route.ts");
    expect(logout).toContain("buyerTrustedSession.updateMany");
    expect(logout).toContain('reason: "LOGOUT"');
    expect(suspension).toContain("buyerTrustedSession.updateMany");
  });

  it("keeps quote comparisons anonymous until authoritative selection", () => {
    const data = read("lib/buyer/data.ts");
    const selection = read("lib/quotes/selection.ts");
    const requestProjection = data.slice(data.indexOf("const buyerRequestInclude"), data.indexOf("const buyerOrderInclude"));
    expect(requestProjection).not.toContain("supplierCompany:");
    expect(data).toContain("take: 5");
    expect(selection).toContain('data: { status: "SELECTED"');
    expect(selection).toContain("contactAccessGrant.create");
    expect(selection).toContain("buyerOrder.create");
    expect(selection).toContain('type: "SEND_CONTACT_UNLOCK"');
    expect(selection).toContain('idempotencyKey: `contact-unlock:${grant.id}`');
  });

  it("uses an immutable per-order rewards ledger", () => {
    const migration = read("supabase/migrations/20260824170900_buyer_hub_passwordless_orders_rewards.sql");
    expect(migration).toContain("buyer_reward_ledger_immutable");
    expect(migration).toContain('UNIQUE ("buyerOrderId", "entryType")');
    expect(migration).toContain("ON CONFLICT (\"buyerOrderId\", \"entryType\") DO NOTHING");
    expect(migration).toContain("COALESCE(SUM(ledger.points)");
  });

  it("authorises buyer files by request ownership before signing a private URL", () => {
    const download = read("app/api/attachments/[id]/download/route.ts");
    expect(download).toContain("getBuyerSession");
    expect(download).toContain("customerContactId: buyerSession.buyer.id");
    expect(download.indexOf("const permitted")).toBeLessThan(download.indexOf("createSignedUrl"));
    expect(download).toContain('scanStatus !== "CLEAN"');
  });

  it("publishes only buyer-owned RLS data for live updates and records the security baseline", () => {
    const migration = read("supabase/migrations/20260824170900_buyer_hub_passwordless_orders_rewards.sql");
    const realtime = read("components/buyer/buyer-realtime-refresh.tsx");
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE bridge_ai."BuyerOrder"');
    expect(migration).toContain('ALTER TABLE bridge_ai."BuyerOrder" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain("SYSTEM.BUYER_HUB_SECURITY_ENABLED");
    expect(realtime).toContain('filter: `customerContactId=eq.${buyerId}`');
    expect(realtime).toContain('window.setInterval(() => router.refresh(), 60_000)');
  });
});
