import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FOUNDING_PLAN_CODE,
  FOUNDING_SUPPLIER_LIMIT,
  INTRODUCTORY_MONTHS,
  INTRODUCTORY_PRICE_PENCE,
  STANDARD_PRICE_PENCE,
  isFoundingSupplier,
} from "@/lib/billing/pricing";

describe("founding supplier pricing", () => {
  it("defines the approved commercial model", () => {
    expect(FOUNDING_SUPPLIER_LIMIT).toBe(100);
    expect(INTRODUCTORY_MONTHS).toBe(6);
    expect(INTRODUCTORY_PRICE_PENCE).toBe(2_999);
    expect(STANDARD_PRICE_PENCE).toBe(4_999);
    expect(FOUNDING_PLAN_CODE).toBe("bridge-ai-founding-supplier");
    expect(isFoundingSupplier(1)).toBe(true);
    expect(isFoundingSupplier(100)).toBe(true);
    expect(isFoundingSupplier(101)).toBe(false);
    expect(isFoundingSupplier(null)).toBe(false);
  });

  it("uses Stripe Tax and a six-month two-price schedule", () => {
    const checkout = readFileSync("app/api/billing/subscription/checkout/route.ts", "utf8");
    const webhook = readFileSync("app/api/webhooks/stripe/route.ts", "utf8");
    expect(checkout).toContain('automatic_tax: { enabled: true }');
    expect(checkout).toContain('tax_id_collection: { enabled: true }');
    expect(checkout).toContain("introductoryMembershipPriceId()");
    expect(webhook).toContain("ensureFoundingPriceSchedule");
    expect(webhook).toContain('duration: { interval: "month", interval_count: INTRODUCTORY_MONTHS }');
    expect(webhook).toContain("standardMembershipPriceId()");
  });

  it("enforces immutable founding places in PostgreSQL", () => {
    const migration = readFileSync("supabase/migrations/20260805215057_founding_supplier_pricing.sql", "utf8");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("FOUNDING_SUPPLIER_CAPACITY_REACHED");
    expect(migration).toContain('BETWEEN 1 AND 100');
    expect(migration).toContain("founding supplier place is server controlled");
  });
});
