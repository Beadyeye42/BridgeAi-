export function authUserWasCreatedForRequest(createdAt: string | undefined, requestStartedAt: number) {
  if (!createdAt) return false;
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return false;

  // Supabase can return an existing unconfirmed user from signUp. Only remove
  // the Auth record when its creation timestamp proves this request created it.
  return createdAtMs >= requestStartedAt - 1_000;
}

export function supplierBootstrapError(cause: unknown) {
  const message = cause instanceof Error ? cause.message.toLowerCase() : "";
  if (message.includes("invalid affiliate referral code")) {
    return { status: 400, message: "This affiliate referral link is no longer valid." } as const;
  }
  if (message.includes("affiliate self-referral")) {
    return { status: 409, message: "An affiliate cannot refer their own supplier account." } as const;
  }
  if (message.includes("portal profile already exists") || message.includes("portal_profiles_email_key")) {
    return { status: 409, message: "This email is already linked to a Bridge-iT account. Sign in, reset the password, or contact support if you cannot access it." } as const;
  }
  return { status: 500, message: "We could not create your supplier workspace." } as const;
}

type AuthProviderError = {
  code?: string;
  message?: string;
  status?: number;
};

export function supplierSignUpError(error: AuthProviderError | null | undefined, identitiesMissing = false) {
  const code = error?.code?.toLowerCase() ?? "";
  const message = error?.message?.toLowerCase() ?? "";
  const emailDeliveryLimited = error?.status === 429
    || code === "over_email_send_rate_limit"
    || message.includes("email rate limit");

  if (emailDeliveryLimited) {
    return {
      status: 429,
      message: "We cannot send the verification email just now. Please wait up to one hour and try again. Your supplier account has not been created.",
      retryAfterSeconds: 3_600,
    } as const;
  }

  if (identitiesMissing || code === "user_already_exists") {
    return {
      status: 409,
      message: "This email is already linked to a Bridge-iT account. Sign in, reset the password, or contact support if you cannot access it.",
      retryAfterSeconds: null,
    } as const;
  }

  return {
    status: 503,
    message: "We could not create your account just now. Please try again shortly.",
    retryAfterSeconds: null,
  } as const;
}
