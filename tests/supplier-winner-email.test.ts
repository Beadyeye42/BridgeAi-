import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSupplierNotificationEmail, buildSupplierWinnerEmail } from "@/lib/notifications/winner-email";

const selection = readFileSync("lib/quotes/selection.ts", "utf8");
const worker = readFileSync("lib/notifications/email-worker.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260806215024_supplier_winner_email_notifications.sql", "utf8");
const opportunityMigration = readFileSync("supabase/migrations/20260807190000_supplier_opportunity_email_notifications.sql", "utf8");
const returningMigration = readFileSync("supabase/migrations/20260807191500_supplier_email_worker_returning_policies.sql", "utf8");
const assignmentNotifications = readFileSync("lib/notifications/assignment-notifications.ts", "utf8");
const automaticAssignment = readFileSync("lib/whatsapp/processor.ts", "utf8");
const replacementAssignment = readFileSync("lib/matching/replacements.ts", "utf8");
const rematchAssignment = readFileSync("lib/matching/rematch.ts", "utf8");
const adminAssignment = readFileSync("app/api/admin/assignments/route.ts", "utf8");

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
    expect(worker).toContain("bridge-ai-supplier-opportunity-${notification.id}");
    expect(worker).toContain("'NEW_QUOTE_REQUEST', 'QUOTATION_ACCEPTED'");
  });

  it("queues matched-opportunity email for every assignment path and respects preferences", () => {
    expect(assignmentNotifications).toContain("emailNewRequests !== false");
    expect(assignmentNotifications).toContain('channel: "EMAIL"');
    expect(assignmentNotifications).toContain("skipDuplicates: true");
    for (const path of [automaticAssignment, replacementAssignment, rematchAssignment, adminAssignment]) {
      expect(path).toContain("queueSupplierAssignmentNotifications");
    }
  });

  it("binds opportunity email RLS to an active assignment and opt-out", () => {
    expect(opportunityMigration).toContain("whatsapp_ai_new_request_email_insert");
    expect(opportunityMigration).toContain('assignment.status IN (\'PENDING\', \'VIEWED\', \'ACCEPTED\')');
    expect(opportunityMigration).toContain('NOT preference."emailNewRequests"');
    expect(opportunityMigration).not.toContain('ON bridge_ai."CustomerContact"');
    expect(opportunityMigration).not.toContain('ON bridge_ai."WhatsAppMessage"');
  });

  it("limits the worker with RLS and excludes customer data", () => {
    expect(migration).toContain("supplier_email_notification_select");
    expect(migration).toContain("supplier_email_active_profile_select");
    expect(migration).not.toContain('ON bridge_ai."CustomerContact"');
    expect(migration).not.toContain('ON bridge_ai."WhatsAppMessage"');
    expect(returningMigration).toContain("supplier_email_audit_select");
    expect(returningMigration).toContain("supplier_email_system_event_select");
    expect(returningMigration).toContain("NOTIFICATION.SUPPLIER\\_%");
    expect(returningMigration).not.toContain('ON bridge_ai."CustomerContact"');
  });

  it("renders a polished email without leaking unescaped content", () => {
    const email = buildSupplierWinnerEmail({
      recipientFirstName: '<Brian & "team">',
      title: "Your quote was selected for BA-2026-TEST",
      body: "Open Bridge AI to continue.",
      portalUrl: "https://bridge-ai.example/dashboard/requests/BA-2026-TEST",
    });
    expect(email.subject).toBe("Your quote was selected for BA-2026-TEST");
    expect(email.html).toContain("&lt;Brian &amp; &quot;team&quot;&gt;");
    expect(email.html).not.toContain("customer@example.com");
    expect(email.text).toContain("Customer contact details are available only after you sign in");

    const opportunity = buildSupplierNotificationEmail({
      kind: "NEW_QUOTE_REQUEST",
      recipientFirstName: "Sam",
      title: "New matched request BA-2026-TEST",
      body: "Six aluminium windows match your coverage.",
      portalUrl: "https://bridge-ai.example/dashboard/requests/BA-2026-TEST",
    });
    expect(opportunity.html).toContain("New matched opportunity");
    expect(opportunity.html).toContain("Review opportunity");
    expect(opportunity.text).toContain("Customer contact details are not included in email");
  });
});
