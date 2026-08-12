import "server-only";
import Stripe from "stripe";
import { Prisma, type MembershipPlan, type MembershipPromotion } from "@prisma/client";
import { BRAND_NAME } from "@/lib/brand";
import { prisma, runAsDatabaseWorker } from "@/lib/db";

let client: Stripe | null = null;

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("Stripe is not configured");
  client ??= new Stripe(key, { appInfo: { name: BRAND_NAME, version: "0.1.0" } });
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
    process.env.STRIPE_SECRET_KEY?.trim(),
  );
}

export async function ensureMembershipPlanStripePrice(plan: MembershipPlan) {
  if (plan.providerPriceId) return plan.providerPriceId;
  const stripe = getStripe();
  let productId = plan.providerProductId;
  if (!productId) {
    const product = await stripe.products.create({
      name: `${BRAND_NAME} ${plan.name}`,
      description: plan.description ?? undefined,
      metadata: { membershipPlanId: plan.id, planCode: plan.code, membershipTier: plan.tier },
    }, { idempotencyKey: `membership-product:${plan.id}` });
    productId = product.id;
  }
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: plan.monthlyPricePence,
    currency: plan.currency.toLowerCase(),
    recurring: { interval: "month" },
    tax_behavior: plan.taxEnabled ? "exclusive" : "unspecified",
    metadata: { membershipPlanId: plan.id, planCode: plan.code, membershipTier: plan.tier },
  }, { idempotencyKey: `membership-price:${plan.id}:${plan.monthlyPricePence}:${plan.currency}:${plan.taxEnabled}` });
  await runAsDatabaseWorker("stripe_billing", (tx) => tx.membershipPlan.update({
    where: { id: plan.id },
    data: { providerProductId: productId, providerPriceId: price.id },
  }));
  return price.id;
}

export async function refreshMembershipPlanStripePrice(planId: string) {
  const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { id: planId } });
  return ensureMembershipPlanStripePrice({ ...plan, providerPriceId: null });
}

export async function ensureMembershipPromotionStripeCoupon(promotion: MembershipPromotion, plan: MembershipPlan) {
  if (!promotion.eligiblePlanCodes.includes(plan.code)) throw new Error("Promotion is not valid for this membership plan");
  if (promotion.promotionalPricePence >= plan.monthlyPricePence) throw new Error("Promotion price must be below the plan price");
  const stored = promotion.providerCouponIds && typeof promotion.providerCouponIds === "object" && !Array.isArray(promotion.providerCouponIds)
    ? promotion.providerCouponIds as Record<string, unknown>
    : {};
  const existing = stored[plan.code];
  if (typeof existing === "string" && existing) return existing;
  const stripe = getStripe();
  const coupon = await stripe.coupons.create({
    name: `${promotion.name} — ${plan.name}`,
    amount_off: plan.monthlyPricePence - promotion.promotionalPricePence,
    currency: plan.currency.toLowerCase(),
    duration: "repeating",
    duration_in_months: promotion.durationMonths,
    metadata: { membershipPromotionId: promotion.id, membershipPlanId: plan.id, planCode: plan.code },
  }, { idempotencyKey: `membership-promotion:${promotion.id}:${plan.id}:${promotion.promotionalPricePence}:${promotion.durationMonths}` });
  await runAsDatabaseWorker("stripe_billing", (tx) => tx.membershipPromotion.update({
    where: { id: promotion.id },
    data: { providerCouponIds: { ...stored, [plan.code]: coupon.id } as Prisma.InputJsonValue },
  }));
  return coupon.id;
}
