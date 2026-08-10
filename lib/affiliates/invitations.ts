import { createHash } from "node:crypto";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type AffiliateIdentity = {
  email: string;
  firstName: string;
  lastName: string;
};

export function affiliateInvitationCallbackUrl(origin: string, tokenHash: string, type: EmailOtpType) {
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("token_hash", tokenHash);
  callback.searchParams.set("type", type);
  callback.searchParams.set("next", "/reset-password");
  return callback.toString();
}

export function affiliateInvitationIdempotencyKey(userId: string, tokenHash: string) {
  const tokenVersion = createHash("sha256").update(tokenHash).digest("hex").slice(0, 20);
  return `bridge-ai-affiliate-invite-${userId}-${tokenVersion}`;
}

export async function createAffiliateInvitation(identity: AffiliateIdentity, origin: string) {
  const { data, error } = await getSupabaseAdmin().auth.admin.generateLink({
    type: "invite",
    email: identity.email,
    options: {
      data: { first_name: identity.firstName, last_name: identity.lastName, bridge_ai_role: "affiliate" },
      redirectTo: `${origin}/reset-password`,
    },
  });
  if (error || !data.user || !data.properties.hashed_token) {
    throw new Error(error?.message ?? "Affiliate invitation link could not be created");
  }
  return {
    user: data.user,
    invitationUrl: affiliateInvitationCallbackUrl(origin, data.properties.hashed_token, "invite"),
    idempotencyKey: affiliateInvitationIdempotencyKey(data.user.id, data.properties.hashed_token),
  };
}

export async function renewAffiliateInvitation(identity: AffiliateIdentity, userId: string, origin: string) {
  const supabase = getSupabaseAdmin();
  const invite = await supabase.auth.admin.generateLink({
    type: "invite",
    email: identity.email,
    options: {
      data: { first_name: identity.firstName, last_name: identity.lastName, bridge_ai_role: "affiliate" },
      redirectTo: `${origin}/reset-password`,
    },
  });
  const generated = invite.error
    ? await supabase.auth.admin.generateLink({
        type: "recovery",
        email: identity.email,
        options: { redirectTo: `${origin}/reset-password` },
      })
    : invite;
  if (generated.error || !generated.data.properties.hashed_token) {
    throw new Error(generated.error?.message ?? "Affiliate access link could not be renewed");
  }
  const type: EmailOtpType = generated.data.properties.verification_type === "invite" ? "invite" : "recovery";
  return {
    invitationUrl: affiliateInvitationCallbackUrl(origin, generated.data.properties.hashed_token, type),
    idempotencyKey: affiliateInvitationIdempotencyKey(userId, generated.data.properties.hashed_token),
  };
}
