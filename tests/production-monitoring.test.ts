import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOperationalAlertCandidates } from "@/lib/monitoring/candidates";
import { operationalEmailConfiguration, sendOperationalAlertEmail } from "@/lib/email";
import { readFileSync } from "node:fs";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.unstubAllGlobals();
});

describe("production monitoring", () => {
  it("creates deduplicatable alerts without customer message contents", () => {
    const alerts = buildOperationalAlertCandidates({
      failedWhatsAppJobs: [{ id: "job_1", type: "PROCESS_INBOUND", attempts: 3, errorCode: "OPENAI_TIMEOUT" }],
      failedStripeWebhooks: [{ id: "hook_1", eventType: "checkout.session.completed", retryCount: 2, failureReason: "Database unavailable" }],
      problemAttachments: [{ id: "file_1", fileName: "drawing.pdf", scanStatus: "PENDING", createdAt: new Date() }],
      operationalEvents: [],
    }, "https://bridge.example");
    expect(alerts.map((alert) => alert.fingerprint)).toEqual([
      "whatsapp-job:job_1",
      "stripe-webhook:hook_1",
      "attachment:file_1:PENDING",
    ]);
    expect(alerts.every((alert) => alert.actionUrl === "https://bridge.example/admin/system")).toBe(true);
    expect(JSON.stringify(alerts)).not.toContain("customerContact");
  });

  it("turns a quotation submission failure into an administrator alert", () => {
    const alerts = buildOperationalAlertCandidates({
      failedWhatsAppJobs: [],
      failedStripeWebhooks: [],
      problemAttachments: [],
      operationalEvents: [{ id: "event_quote_1", source: "quotation", severity: "ERROR", code: "QUOTATION_SUBMIT_FAILED", message: "Database guard rejected the write" }],
    }, "https://bridge.example");
    expect(alerts).toEqual([expect.objectContaining({
      fingerprint: "system-event:event_quote_1",
      source: "QUOTATION",
      title: "Supplier quotation submission failed",
    })]);
  });

  it("reports missing email configuration honestly", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.MONITORING_ALERT_EMAILS;
    expect(operationalEmailConfiguration()).toMatchObject({ configured: false });
  });

  it("sends a single idempotent digest to configured administrators", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Bridge AI <alerts@bridge.example>";
    process.env.MONITORING_ALERT_EMAILS = "ops@example.com, OPS@example.com";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendOperationalAlertEmail([{ severity: "ERROR", title: "WhatsApp processing failed", body: "Job failed", actionUrl: "https://bridge.example/admin/system" }], "bridge-ai-monitoring-test");
    expect(result).toEqual({ delivered: true, providerEmailId: "email_1" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("bridge-ai-monitoring-test");
    expect(JSON.parse(String(init.body)).to).toEqual(["ops@example.com"]);
  });

  it("protects scheduled and manual monitoring entry points", () => {
    const cron = readFileSync("app/api/cron/monitor-production/route.ts", "utf8");
    const manual = readFileSync("app/api/admin/system/monitor/route.ts", "utf8");
    expect(cron).toContain('request.headers.get("authorization") !== `Bearer ${secret}`');
    expect(manual).toContain("requireAdminApi()");
    expect(manual).toContain("ADMIN.PRODUCTION_MONITORING_RUN");
    expect(manual).toContain("processWhatsAppJobs({ limit: 20 })");
    expect(manual.indexOf("ADMIN.PRODUCTION_MONITORING_RUN")).toBeLessThan(manual.indexOf("runProductionMonitoring()"));
    expect(manual).not.toContain("trustedPrisma");
  });

  it("ignores deliberately superseded WhatsApp failures and keeps maintenance out of the live message path", () => {
    const monitoring = readFileSync("lib/monitoring/operational-alerts.ts", "utf8");
    const database = readFileSync("lib/db.ts", "utf8");
    const migration = readFileSync("supabase/migrations/20260809145934_production_monitoring_worker_rls.sql", "utf8");
    const triggerMigration = readFileSync("supabase/migrations/20260809152418_production_alert_database_audit_trigger.sql", "utf8");
    const processor = readFileSync("lib/whatsapp/processor.ts", "utf8");
    const cron = readFileSync("app/api/cron/monitor-production/route.ts", "utf8");
    expect(monitoring).toContain('NOT: { errorCode: { startsWith: "SUPERSEDED_" } }');
    expect(monitoring).toContain('{ scanStatus: "FAILED" }');
    expect(monitoring).not.toContain('scanStatus: { in: ["FAILED", "REJECTED"] }');
    expect(monitoring).toContain('runAsDatabaseWorker("production_monitoring"');
    expect(monitoring).not.toContain("trustedPrisma");
    expect(database).toContain('"production_monitoring"');
    expect(migration).toContain("production_monitoring_select_failed_whatsapp_jobs");
    expect(migration).toContain("production_monitoring_update_alerts");
    expect(migration).toContain("production_monitoring_insert_audit_logs");
    expect(triggerMigration).toContain("audit_production_alert_change");
    expect(triggerMigration).toContain("DROP POLICY production_monitoring_insert_audit_logs");
    expect(monitoring).not.toContain("tx.auditLog.create");
    expect(processor).not.toContain("expireAndReplaceSupplierInvitations");
    expect(processor).not.toContain("notifySuppliersWithStaleCapacity");
    expect(processor).toContain("if (processed > 0 && flushSupplierEmails)");
    expect(processor).toContain("if (terminalFailure) await runProductionMonitoringSafely()");
    expect(cron).toContain("expireAndReplaceSupplierInvitations({ limit: 100 })");
    expect(cron).toContain("notifySuppliersWithStaleCapacity({ limit: 100 })");
    expect(cron).toContain("processWhatsAppJobs({ limit: 50, concurrency: 5, flushSupplierEmails: false })");
  });
});
