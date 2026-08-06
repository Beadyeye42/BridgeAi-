import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Stripe billing database isolation", () => {
  it("runs checkout persistence through the Stripe worker context", () => {
    const route = read("app/api/billing/subscription/checkout/route.ts");
    expect(route).toContain('runAsDatabaseWorker("stripe_billing"');
    expect(route).not.toContain("trustedPrisma");
  });

  it("runs verified webhook persistence through the same worker context", () => {
    const route = read("app/api/webhooks/stripe/route.ts");
    expect(route).toContain('runAsDatabaseWorker("stripe_billing"');
    expect(route).not.toContain("trustedPrisma");
  });

  it("defines narrow forced-RLS policies for billing writes", () => {
    const migration = read("supabase/migrations/20260806185317_stripe_billing_worker_rls.sql");
    expect(migration).toContain("stripe_billing_subscription_insert");
    expect(migration).toContain("stripe_billing_subscription_update");
    expect(migration).toContain("stripe_billing_webhook_event_insert");
    expect(migration).toContain("stripe_billing_audit_insert");
    expect(migration).toContain("source = 'STRIPE_WEBHOOK'");
    expect(migration).toContain("is_trusted_worker('stripe_billing')");
    const alertsMigration = read("supabase/migrations/20260806185620_stripe_checkout_failure_alerts.sql");
    expect(alertsMigration).toContain("source IN ('STRIPE_WEBHOOK', 'STRIPE_CHECKOUT')");
  });

  it("records and alerts on checkout creation failures", () => {
    const route = read("app/api/billing/subscription/checkout/route.ts");
    expect(route).toContain("STRIPE_CHECKOUT_CREATION_FAILED");
    expect(route).toContain("runProductionMonitoringSafely");
    expect(route).not.toContain("error.message.slice");
  });
});
