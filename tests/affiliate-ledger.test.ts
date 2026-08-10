import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateEligibleInvoiceRevenue } from "@/lib/affiliates/stripe-ledger";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("affiliate invoice accounting", () => {
  it("excludes tax and non-subscription invoice items", () => {
    expect(calculateEligibleInvoiceRevenue({
      invoiceTotalPence: 13_200,
      invoiceTotalExcludingTaxPence: 11_000,
      amountPaidPence: 13_200,
      subscriptionLinesExcludingTaxPence: [10_000],
    })).toBe(10_000);
  });

  it("uses the amount actually collected for a partially paid invoice", () => {
    expect(calculateEligibleInvoiceRevenue({
      invoiceTotalPence: 12_000,
      invoiceTotalExcludingTaxPence: 10_000,
      amountPaidPence: 6_000,
      subscriptionLinesExcludingTaxPence: [10_000],
    })).toBe(5_000);
  });

  it("never creates revenue for free, credited or failed payments", () => {
    expect(calculateEligibleInvoiceRevenue({ invoiceTotalPence: 0, invoiceTotalExcludingTaxPence: 0, amountPaidPence: 0, subscriptionLinesExcludingTaxPence: [0] })).toBe(0);
    expect(calculateEligibleInvoiceRevenue({ invoiceTotalPence: 12_000, invoiceTotalExcludingTaxPence: 10_000, amountPaidPence: 0, subscriptionLinesExcludingTaxPence: [10_000] })).toBe(0);
  });

  it("has one immutable invoice row and separate refund/dispute keys", () => {
    const migration = read("supabase/migrations/20260809131748_affiliate_invoice_ledger.sql");
    expect(migration).toContain("affiliate_one_invoice_ledger_row");
    expect(migration).toContain("affiliate commission accounting fields are immutable");
    expect(migration).toContain("affiliate_one_refund_adjustment");
    expect(migration).toContain("affiliate_one_dispute_adjustment");
    expect(migration).toContain("validate_affiliate_commissions");
    expect(migration).toContain("paid_period = 1");
    expect(migration).toContain("commission_sequence := paid_period - 1");
    expect(migration).toContain("affiliate_rate + 5000");
  });

  it("derives earnings from invoice transactions rather than customer counts", () => {
    const dashboard = read("app/affiliate/page.tsx");
    expect(dashboard).toContain("tx.affiliateCommission.findMany");
    expect(dashboard).toContain("tx.affiliateCommission.aggregate");
    expect(dashboard).toContain("tx.affiliateReferral.count");
    expect(dashboard).not.toMatch(/const active = referrals\.filter/);
    expect(dashboard).not.toMatch(/active[^\n]*\*[^\n]*(commission|rate)/i);
    const payout = read("app/api/admin/affiliates/payouts/route.ts");
    expect(payout).toContain("commissionAmountPence");
    expect(payout).toContain("NO_POSITIVE_BALANCE");
  });

  it("processes only verified Stripe lifecycle events through the worker", () => {
    const webhook = read("app/api/webhooks/stripe/route.ts");
    for (const event of ["invoice.paid", "invoice.payment_failed", "customer.subscription.updated", "customer.subscription.deleted", "refund.created", "charge.refunded", "charge.dispute.created"]) expect(webhook).toContain(event);
    expect(webhook).toContain("constructEvent");
    expect(webhook).toContain('runAsDatabaseWorker("stripe_billing"');
    expect(webhook).toContain("after(runProductionMonitoringSafely)");
  });

  it("notifies affiliates and administrators when a referred subscription is cancelled", () => {
    const ledger = read("lib/affiliates/stripe-ledger.ts");
    const migration = read("supabase/migrations/20260809193000_affiliate_cancellation_admin_alerts.sql");
    expect(ledger).toContain('source: "AFFILIATE_LIFECYCLE"');
    expect(ledger).toContain("affiliate-cancellation-scheduled:");
    expect(ledger).toContain("affiliate-cancellation-completed:");
    expect(ledger).toContain("tx.productionAlert.createMany");
    expect(migration).toContain("production_alert_stripe_affiliate_insert");
    expect(migration).toContain("bridge_private.is_trusted_worker('stripe_billing')");
    expect(migration).toContain("fingerprint LIKE 'affiliate-cancellation-%'");
  });

  it("keeps affiliate dashboards live with an RLS-protected recovery path", () => {
    const refresh = read("components/affiliate/realtime-refresh.tsx");
    const shell = read("components/affiliate/affiliate-shell.tsx");
    for (const table of ["affiliate_referrals", "affiliate_commissions", "affiliate_notifications", "affiliate_payouts"]) expect(refresh).toContain(table);
    expect(refresh).toContain('schema: "bridge_ai"');
    expect(refresh).toContain("affiliateId=eq.${affiliateId}");
    expect(refresh).toContain("router.refresh()");
    expect(refresh).toContain("60_000");
    expect(refresh).toContain('document.addEventListener("visibilitychange"');
    expect(shell).toContain("affiliate-mobile-nav");
    expect(shell).toContain("<LogoutButton />");
    expect(shell).toContain("<LogoutButton compact />");
  });

  it("keeps affiliate invitations administrator-only and readable", () => {
    const page = read("app/admin/affiliates/page.tsx");
    const form = read("components/admin/affiliate-manager.tsx");
    const guard = read("lib/auth/guards.ts");
    expect(page).toContain("await requireAdminPage()");
    expect(page).toContain("admin-affiliate-invite");
    expect(page).toContain("They will receive their own separate portal and will never see this administrator console.");
    expect(form).toContain("affiliate-form-grid");
    expect(form).toContain('htmlFor="affiliate-email"');
    expect(form).toContain("Activate this affiliate immediately");
    expect(guard).toContain('session.user.role !== "ADMINISTRATOR"');
  });

  it("forces RLS and prevents cross-affiliate reads", () => {
    const migration = read("supabase/migrations/20260809131748_affiliate_invoice_ledger.sql");
    for (const table of ["affiliates", "affiliate_referrals", "affiliate_commissions", "affiliate_payouts", "affiliate_notifications", "affiliate_audit_logs"]) {
      expect(migration).toContain(`ALTER TABLE bridge_ai.${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain('affiliate."userId" = (SELECT bridge_private.current_user_id())');
    expect(migration).toContain("affiliate self-referral is not permitted");
    expect(migration).toContain("supplier attribution is already locked");
  });

  it("keeps supplier commercial entitlements administrator controlled", () => {
    const migration = read("supabase/migrations/20260809145500_protect_supplier_commercial_identity.sql");
    expect(migration).toContain('NEW."foundingMemberNumber" IS DISTINCT FROM OLD."foundingMemberNumber"');
    expect(migration).toContain("bridge_private.is_platform_admin()");
  });

  it("keeps affiliate Data API access read-only except notification read state", () => {
    const migration = read("supabase/migrations/20260809150500_affiliate_portal_data_api_grants.sql");
    expect(migration).toContain("GRANT SELECT ON TABLE");
    expect(migration).toContain('GRANT UPDATE ("readAt")');
    expect(migration).toContain("REVOKE INSERT, DELETE");
  });

  it("uses a narrow identity-derived supplier summary instead of bypassing company isolation", () => {
    const migration = read("supabase/migrations/20260810202500_affiliate_supplier_summary.sql");
    const dashboard = read("app/affiliate/page.tsx");
    const referrals = read("app/affiliate/referrals/page.tsx");
    const earnings = read("app/affiliate/earnings/page.tsx");
    expect(migration).toContain("current_affiliate_referral_summaries");
    expect(migration).toContain('affiliate."userId" = bridge_private.current_user_id()');
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
    for (const privateField of ["contactEmail", "contactPhone", "address", "companyProfile"]) {
      expect(migration).not.toMatch(new RegExp(`company\\.\\"${privateField}\\"`));
    }
    expect(dashboard).toContain("getCurrentAffiliateReferralSummaries");
    expect(referrals).toContain("getCurrentAffiliateReferralSummaries");
    expect(earnings).toContain("getCurrentAffiliateReferralSummaries");
    expect(dashboard).not.toContain("include: { supplierCompany");
    expect(referrals).not.toContain("include: { supplierCompany");
    expect(earnings).not.toContain("include: { supplierCompany");
  });

  it("indexes ledger relationships used by high-volume accounting queries", () => {
    const migration = read("supabase/migrations/20260809151500_affiliate_ledger_foreign_key_indexes.sql");
    for (const field of ['"subscriptionId"', '"membershipPlanId"', '"sourceCommissionId"']) expect(migration).toContain(field);
  });
});
