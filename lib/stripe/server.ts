import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("Stripe is not configured");
  client ??= new Stripe(key, { appInfo: { name: "Bridge AI", version: "0.1.0" } });
  return client;
}

export function introductoryMembershipPriceId() {
  const value = process.env.STRIPE_INTRODUCTORY_PRICE_ID?.trim();
  if (!value) throw new Error("Stripe introductory supplier price is not configured");
  return value;
}

export function standardMembershipPriceId() {
  const value = process.env.STRIPE_STANDARD_PRICE_ID?.trim();
  if (!value) throw new Error("Stripe standard supplier price is not configured");
  return value;
}

export function stripeWebhookSecret() {
  const value = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!value) throw new Error("Stripe webhook verification is not configured");
  return value;
}

export function stripeConfigured() {
  return Boolean(
    process.env.STRIPE_SECRET_KEY?.trim()
    && process.env.STRIPE_INTRODUCTORY_PRICE_ID?.trim()
    && process.env.STRIPE_STANDARD_PRICE_ID?.trim(),
  );
}
