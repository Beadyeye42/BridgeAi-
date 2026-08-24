import "server-only";

import { createHash } from "node:crypto";
import { applicationOrigin, metaBuyerLoginTemplate } from "@/lib/config";
import { runAsDatabaseWorker } from "@/lib/db";
import { blindIndex, decryptPrivateValue } from "@/lib/security/encryption";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { sendMetaTemplate } from "@/lib/whatsapp/meta-client";

const CHALLENGE_MINUTES = 10;
const CUSTOMER_LIMIT_PER_HOUR = 5;
const NETWORK_LIMIT_PER_HOUR = 12;
const TRUSTED_DEVICE_DAYS = 30;

export const BUYER_LOGIN_NEUTRAL_MESSAGE =
  "If that WhatsApp number is linked to Bridge-iT, a secure sign-in link will arrive shortly.";

export function normalizeBuyerPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `44${digits.slice(1)}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeBuyerPath(value: string | null | undefined) {
  if (!value?.startsWith("/buyer") || value.startsWith("//")) return "/buyer";
  return value.slice(0, 512);
}

function buyerIdentityEmail(phoneHash: string) {
  return `buyer+${phoneHash.slice(0, 40)}@auth.bridge-it.invalid`;
}

async function recordEvent(input: {
  customerContactId?: string;
  authUserId?: string;
  eventType: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  await runAsDatabaseWorker("buyer_auth", (tx) => tx.buyerSecurityEvent.create({ data: input })).catch(() => undefined);
}

async function ensureBuyerAuthUser(customer: { id: string; phoneHash: string; buyerAuthUserId: string | null }) {
  if (customer.buyerAuthUserId) return customer.buyerAuthUserId;

  const admin = getSupabaseAdmin();
  const created = await admin.auth.admin.createUser({
    email: buyerIdentityEmail(customer.phoneHash),
    email_confirm: true,
    user_metadata: { account_type: "buyer", customer_contact_id: customer.id },
    app_metadata: { role: "buyer" },
  });
  if (created.error || !created.data.user) throw new Error("BUYER_AUTH_USER_CREATE_FAILED");

  const linked = await runAsDatabaseWorker("buyer_auth", async (tx) => {
    await tx.customerContact.updateMany({
      where: { id: customer.id, buyerAuthUserId: null },
      data: { buyerAuthUserId: created.data.user.id },
    });
    return tx.customerContact.findUnique({ where: { id: customer.id }, select: { buyerAuthUserId: true } });
  });
  if (!linked?.buyerAuthUserId) throw new Error("BUYER_AUTH_USER_LINK_FAILED");
  return linked.buyerAuthUserId;
}

export async function requestBuyerLogin(input: {
  phone: string;
  requestUrl: string;
  requestedPath?: string | null;
  requestIp?: string | null;
  userAgent?: string | null;
}) {
  const phone = normalizeBuyerPhone(input.phone);
  if (!phone) return;

  const phoneHash = blindIndex(phone);
  const requestIpHash = input.requestIp ? blindIndex(`buyer-login-ip:${input.requestIp}`) : null;
  const userAgentHash = input.userAgent ? digest(input.userAgent.slice(0, 1_000)) : null;
  const since = new Date(Date.now() - 60 * 60 * 1_000);

  const customer = await runAsDatabaseWorker("buyer_auth", (tx) => tx.customerContact.findUnique({
    where: { phoneHash },
    select: {
      id: true,
      phoneHash: true,
      phoneEncrypted: true,
      buyerAuthUserId: true,
      buyerPortalStatus: true,
    },
  }));
  if (!customer || customer.buyerPortalStatus !== "ACTIVE") return;

  const limited = await runAsDatabaseWorker("buyer_auth", async (tx) => {
    const [customerCount, networkCount] = await Promise.all([
      tx.buyerLoginChallenge.count({ where: { customerContactId: customer.id, createdAt: { gte: since } } }),
      requestIpHash
        ? tx.buyerLoginChallenge.count({ where: { requestIpHash, createdAt: { gte: since } } })
        : Promise.resolve(0),
    ]);
    return customerCount >= CUSTOMER_LIMIT_PER_HOUR || networkCount >= NETWORK_LIMIT_PER_HOUR;
  });
  if (limited) {
    await recordEvent({ customerContactId: customer.id, authUserId: customer.buyerAuthUserId ?? undefined, eventType: "BUYER_LOGIN_RATE_LIMITED" });
    return;
  }

  let authUserId: string | undefined;
  let challengeId: string | undefined;
  try {
    authUserId = await ensureBuyerAuthUser(customer);
    const admin = getSupabaseAdmin();
    const generated = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: buyerIdentityEmail(phoneHash),
    });
    const tokenHash = generated.data?.properties?.hashed_token;
    if (generated.error || !tokenHash) throw new Error("BUYER_AUTH_LINK_CREATE_FAILED");

    const challenge = await runAsDatabaseWorker("buyer_auth", (tx) => tx.buyerLoginChallenge.create({
      data: {
        customerContactId: customer.id,
        authUserId: authUserId!,
        tokenDigest: digest(tokenHash),
        requestedPath: safeBuyerPath(input.requestedPath),
        requestIpHash,
        userAgentHash,
        expiresAt: new Date(Date.now() + CHALLENGE_MINUTES * 60 * 1_000),
      },
      select: { id: true },
    }));
    challengeId = challenge.id;

    const template = metaBuyerLoginTemplate();
    if (!template) throw new Error("BUYER_LOGIN_TEMPLATE_NOT_CONFIGURED");
    const origin = applicationOrigin(input.requestUrl);
    const url = new URL("/buyer/auth/verify", origin);
    // Keep both bearer secrets in the URL fragment. Browsers do not send the
    // fragment in HTTP requests, access logs or referrer headers. The verifier
    // removes it before exchanging the values with our same-origin API.
    url.hash = new URLSearchParams({
      challenge: challenge.id,
      token_hash: tokenHash,
      type: "magiclink",
    }).toString();
    await sendMetaTemplate({
      to: decryptPrivateValue(customer.phoneEncrypted),
      ...template,
      parameters: [url.toString()],
    });
    await recordEvent({ customerContactId: customer.id, authUserId, eventType: "BUYER_LOGIN_LINK_SENT" });
  } catch (error) {
    if (challengeId) {
      await runAsDatabaseWorker("buyer_auth", (tx) => tx.buyerLoginChallenge.updateMany({
        where: { id: challengeId, consumedAt: null },
        data: { revokedAt: new Date() },
      })).catch(() => undefined);
    }
    await recordEvent({
      customerContactId: customer.id,
      authUserId,
      eventType: "BUYER_LOGIN_LINK_FAILED",
      metadata: { errorType: error instanceof Error ? error.message.slice(0, 64) : "UNKNOWN" },
    });
  }
}

export async function consumeBuyerChallenge(input: {
  challengeId: string;
  tokenHash: string;
  userAgent?: string | null;
}) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(input.challengeId) || input.tokenHash.length < 20 || input.tokenHash.length > 512) {
    return null;
  }
  const tokenDigest = digest(input.tokenHash);
  const now = new Date();
  return runAsDatabaseWorker("buyer_auth", async (tx) => {
    const challenge = await tx.buyerLoginChallenge.findFirst({
      where: {
        id: input.challengeId,
        tokenDigest,
        expiresAt: { gt: now },
        consumedAt: null,
        revokedAt: null,
      },
      select: { id: true, customerContactId: true, authUserId: true, requestedPath: true, userAgentHash: true },
    });
    if (!challenge) return null;
    const consumed = await tx.buyerLoginChallenge.updateMany({
      where: { id: challenge.id, tokenDigest, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) return null;
    await tx.customerContact.update({ where: { id: challenge.customerContactId }, data: { buyerLastLoginAt: now } });
    await tx.buyerSecurityEvent.create({
      data: {
        customerContactId: challenge.customerContactId,
        authUserId: challenge.authUserId,
        eventType: "BUYER_LOGIN_CHALLENGE_CONSUMED",
        metadata: {
          userAgentChanged: Boolean(challenge.userAgentHash && input.userAgent && challenge.userAgentHash !== digest(input.userAgent.slice(0, 1_000))),
        },
      },
    });
    return challenge;
  });
}

export async function registerBuyerTrustedSession(input: {
  customerContactId: string;
  authUserId: string;
  sessionId: string;
  userAgent?: string | null;
}) {
  if (!/^[0-9a-f-]{36}$/i.test(input.sessionId)) throw new Error("BUYER_SESSION_ID_INVALID");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1_000);
  return runAsDatabaseWorker("buyer_auth", async (tx) => {
    const buyer = await tx.customerContact.findFirst({
      where: {
        id: input.customerContactId,
        buyerAuthUserId: input.authUserId,
        buyerPortalStatus: "ACTIVE",
      },
      select: { id: true },
    });
    if (!buyer) throw new Error("BUYER_SESSION_SCOPE_MISMATCH");
    await tx.buyerTrustedSession.upsert({
      where: { sessionId: input.sessionId },
      create: {
        customerContactId: input.customerContactId,
        authUserId: input.authUserId,
        sessionId: input.sessionId,
        userAgentHash: input.userAgent ? digest(input.userAgent.slice(0, 1_000)) : null,
        expiresAt,
        lastSeenAt: now,
      },
      update: {
        userAgentHash: input.userAgent ? digest(input.userAgent.slice(0, 1_000)) : null,
        expiresAt,
        lastSeenAt: now,
        revokedAt: null,
      },
    });
    await tx.customerContact.update({
      where: { id: input.customerContactId },
      data: { buyerLastLoginAt: now },
    });
    await tx.buyerSecurityEvent.create({
      data: {
        customerContactId: input.customerContactId,
        authUserId: input.authUserId,
        eventType: "BUYER_TRUSTED_SESSION_CREATED",
        metadata: { expiresAt: expiresAt.toISOString() },
      },
    });
  });
}
