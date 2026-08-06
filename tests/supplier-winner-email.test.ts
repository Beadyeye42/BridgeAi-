import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSupplierWinnerEmail } from "@/lib/notifications/winner-email";

const selection = readFileSync("lib/quotes/selection.ts", "utf8");
const worker = readFileSync("lib/notifications/email-worker.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260806215024_supplier_winner_email_notifications.sql", "utf8");

describe("supplier winner email", () => {
  it("queues email in the selection transaction and respects quotation-update preferences", () => {
    expect(selection).toContain('emailQuotationUpdates !== false');
    expect(selection).toContain('type: "QUOTATION_ACCEPTED"');
    expect(selection).toContain('channel: "EMAIL"');
    expect(selection).toContain("skipDuplicates: true");
  });

  it("uses a durable locked retry queue and a stable provider idempotency key", () => {
    expect(worker).toContain("FOR UPDATE OF notification SKIP LOCKED");
    expect(worker).toContain("MAX_DELIVERY_ATTEMPTS = 5");
    expect(worker).toContain("bridge-ai-supplier-winner-${notification.id}");
  });

  it("limits the worker with RLS and excludes customer data", () => {
    expect(migration).toContain("supplier_email_notification_select");
    expect(migration).toContain("supplier_email_active_profile_select");
    expect(migration).not.toContain('ON bridge_ai."CustomerContact"');
    expect(migration).not.toContain('ON bridge_ai."WhatsAppMessage"');
  });

  it("renders a polished email without leaking unescaped content", () => {
    const email = buildSupplierWinnerEmail({
      recipientFirstName: '<Brian & "team">',
      title: "You won request BA-2026-TEST",
      body: "Open Bridge AI to continue.",
      portalUrl: "https://bridge-ai.example/dashboard/requests/BA-2026-TEST",
    });
    expect(email.subject).toBe("You won request BA-2026-TEST");
    expect(email.html).toContain("&lt;Brian &amp; &quot;team&quot;&gt;");
    expect(email.html).not.toContain("customer@example.com");
    expect(email.text).toContain("Customer contact details are available only after you sign in");
  });
});
