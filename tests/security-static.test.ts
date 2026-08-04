import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("security foundation static controls", () => {
  it("contains no custom password or session implementation", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).not.toMatch(
      /passwordHash|AuthSession|PasswordResetToken|failedLoginAttempts/,
    );
    expect(read("app/api/auth/login/route.ts")).toContain("signInWithPassword");
    expect(read("app/api/auth/reset-password/route.ts")).toContain(
      "updateUser",
    );
  });

  it("keeps service secrets out of client components", () => {
    const files = globSync("{app,components,lib}/**/*.{ts,tsx}");
    for (const file of files) {
      const source = read(file);
      if (source.includes('"use client"') || source.includes("'use client'")) {
        expect(source, file).not.toMatch(
          /SUPABASE_SECRET_KEY|service_role|POSTGRES_|PII_ENCRYPTION|OPENAI_API_KEY|META_WHATSAPP|STRIPE_SECRET|STRIPE_WEBHOOK|CRON_SECRET/,
        );
      }
    }
  });

  it("re-verifies Supabase identity outside an explicit database scope", () => {
    const source = read("lib/db.ts");
    expect(source).toContain("supabase.auth.getUser()");
    expect(source).not.toContain("enterDatabaseIdentity");
  });

  it("does not fan out RLS-scoped Prisma work across the small production pool", () => {
    const files = globSync("{app,lib}/**/*.{ts,tsx}");
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/Promise\.all\([\s\S]{0,4000}prisma\./);
    }
  });

  it("authorises every administrator page before its first database query", () => {
    const pages = globSync("app/admin/**/page.tsx");
    for (const page of pages) {
      const source = read(page);
      const guard = source.indexOf("await requireAdminPage()");
      const firstQuery = source.indexOf("prisma.");
      expect(guard, page).toBeGreaterThan(-1);
      expect(firstQuery, page).toBeGreaterThan(guard);
    }
  });

  it("marks replacement bytes pending before the private Storage upsert", () => {
    const source = read("app/api/uploads/logo/route.ts");
    const pendingMetadata = source.indexOf('scanStatus: "PENDING"');
    const storageUpsert = source.indexOf(".upload(storageKey, bytes");
    expect(pendingMetadata).toBeGreaterThan(-1);
    expect(storageUpsert).toBeGreaterThan(pendingMetadata);
    expect(source).toContain('action: "SUPPLIER.LOGO_UPLOAD_FAILED"');
  });

  it("provisions storage, forced RLS and append-only auditing in committed SQL", () => {
    const migration = read(
      "supabase/migrations/20260802183212_security_foundation.sql",
    );
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("bridge-ai-private");
    expect(migration).toContain("audit_append_only");
    expect(migration).toContain("attachment_exactly_one_parent");
    expect(
      read(
        "supabase/migrations/20260802193121_secure_logo_attachment_lifecycle.sql",
      ),
    ).toContain("attachment_company_logo_delete");
    expect(
      read(
        "supabase/migrations/20260802193700_allow_suspended_company_access_revocation.sql",
      ),
    ).toContain("status NOT IN ('SUSPENDED', 'REJECTED')");
  });

  it("isolates supplier accreditation evidence and protects administrator review state", () => {
    const migration = read("supabase/migrations/20260803220810_supplier_accreditation_documents.sql");
    expect(migration).toContain("supplier_accreditations ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("supplier_accreditations FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("accreditation_company_read");
    expect(migration).toContain("accreditation_company_insert");
    expect(migration).not.toContain("accreditation_company_update");
    expect(read("supabase/migrations/20260803222248_allow_accreditation_attachment_delete.sql")).toContain("attachment_company_accreditation_delete");
    const upload = read("app/api/uploads/accreditation/route.ts");
    expect(upload).toContain('scanStatus: "PENDING"');
    expect(upload).toContain('action: "ACCREDITATION.UPLOADED"');
    expect(upload).not.toMatch(/SUPABASE_SECRET_KEY|service_role/);
    const review = read("app/api/admin/accreditations/[id]/review/route.ts");
    expect(review.indexOf('scanStatus !== "CLEAN"')).toBeLessThan(review.indexOf("supplierAccreditation.update"));
  });

  it("does not retain a parallel Prisma migration history", () => {
    expect(globSync("prisma/migrations/**/*.sql")).toHaveLength(0);
    expect(globSync("supabase/migrations/*.sql").length).toBeGreaterThanOrEqual(
      5,
    );
  });

  it("verifies Meta signatures before parsing or persisting webhook content", () => {
    const source = read("app/api/webhooks/meta-whatsapp/route.ts");
    const handler = source.slice(source.indexOf("export async function POST"));
    const signature = handler.indexOf("verifyMetaSignature(");
    const parse = handler.indexOf("parseMetaWebhook(");
    const transaction = handler.indexOf("runAsDatabaseWorker(");
    expect(signature).toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(signature);
    expect(transaction).toBeGreaterThan(parse);
    expect(source).toContain("encryptPrivateValue(message.from)");
    expect(source).toContain("encryptPrivateValue(message.body)");
    expect(source).not.toContain("trustedPrisma");
    expect(source).not.toContain("payload: JSON.parse");

    const workerPolicy = read("supabase/migrations/20260804181500_whatsapp_webhook_worker_context.sql");
    expect(workerPolicy).toContain("session_user = 'bridge_ai_app'");
    expect(workerPolicy).toContain("bridge_ai.worker_context");
    expect(workerPolicy).toContain("whatsapp_worker_message_insert");

    const auditWriter = read("supabase/migrations/20260804182500_whatsapp_audit_writer.sql");
    expect(auditWriter).toContain("session_user <> 'bridge_ai_app'");
    expect(auditWriter).toContain("SET row_security = 'off'");
    expect(auditWriter).toContain("audit_action NOT LIKE 'WHATSAPP.%'");
    expect(source).toContain("bridge_private.write_whatsapp_audit");
    expect(source).not.toContain("tx.auditLog.create");
  });

  it("keeps customer display names encrypted in the application schema", () => {
    const schema = read("prisma/schema.prisma");
    const customer = schema.slice(schema.indexOf("model CustomerContact"), schema.indexOf("model Conversation"));
    expect(customer).toContain("displayNameEncrypted Bytes?");
    expect(customer).not.toMatch(/\n\s+displayName\s+String/);
  });

  it("uses the shared request deadline and never accepts more than five suppliers", () => {
    const validation = read("lib/auth/validation.ts");
    const assignmentRoute = read("app/api/admin/assignments/route.ts");
    const migration = read("supabase/migrations/20260803182630_enforce_supplier_response_rules.sql");
    expect(validation).toContain("supplierCompanyIds: z.array");
    expect(validation).toContain(".max(5)");
    expect(assignmentRoute).toMatch(/expiresAt:\s*quote\.responseDueAt/);
    expect(assignmentRoute).not.toContain("parsed.data.expiresAt");
    expect(migration).toContain('"distributionLimit" BETWEEN 1 AND 5');
    expect(migration).toContain("Friday 15:00 until Monday 08:00");
  });

  it("rechecks category, subscription and coverage before assignment", () => {
    const assignmentRoute = read("app/api/admin/assignments/route.ts");
    const matching = read("lib/matching/suppliers.ts");
    const coverageRoute = read("app/api/supplier/coverage/route.ts");
    expect(assignmentRoute).toContain("findSupplierMatches(tx");
    expect(matching).toContain('status: "APPROVED"');
    expect(matching).toContain('status: "ACTIVE"');
    expect(matching).toContain("bestCoverageMatch");
    expect(coverageRoute).toContain('action: "COVERAGE.CREATED"');
  });

  it("closes supplier lifecycle and response-window edge cases", () => {
    const decision = read("app/api/assignments/[id]/decision/route.ts");
    expect(decision).toContain("assignment.expiresAt <= new Date()");
    const viewed = read("app/api/assignments/[id]/view/route.ts");
    expect(viewed).toContain('action: "ASSIGNMENT.VIEWED"');
    expect(viewed).toContain('supplierCompanyId: auth.companyId');
    const requests = read("app/dashboard/requests/page.tsx");
    expect(requests).toContain("expiresAt: { gt: now }");
    expect(requests).toContain("expiresAt: { lte: now }");
    const status = read("app/api/admin/suppliers/[id]/status/route.ts");
    expect(status).toContain('existing.status==="SUSPENDED"');
    expect(status).toContain('data:{status:"ACTIVE"}');
    const team = read("app/dashboard/team/page.tsx");
    expect(team).toContain('memberships:{where:{status:"ACTIVE"}');
  });

  it("keeps browser location lookup authenticated and non-persistent", () => {
    const source = read("app/api/supplier/location/postcode/route.ts");
    expect(source.indexOf("requireSupplierApi()")).toBeGreaterThan(-1);
    expect(source.indexOf("requireSupplierApi()")).toBeLessThan(source.indexOf("postcodeFromCoordinates("));
    expect(source).not.toMatch(/prisma\.|trustedPrisma|writeAuditLog/);
  });

  it("unlocks customer contact only through a verified Stripe webhook", () => {
    const webhook = read("app/api/webhooks/stripe/route.ts");
    const handler = webhook.slice(webhook.indexOf("export async function POST"));
    expect(handler.indexOf("constructEvent(")).toBeGreaterThan(-1);
    expect(handler.indexOf("constructEvent(")).toBeLessThan(handler.indexOf("processEvent(event)"));
    expect(webhook).toContain("unlockPaidQuotation");
    expect(webhook).not.toContain("await request.json()");
    const migration = read("supabase/migrations/20260803195826_payment_gated_contact_unlock_schema.sql");
    expect(migration).toContain("supplier_quotation_one_customer_selection");
    expect(migration).toContain("customer selection and payment transitions are server controlled");
    expect(migration).toContain("accepted quotation requires paid fee and contact grant");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    const contact = read("lib/contacts/access.ts");
    expect(contact.indexOf("prisma.contactAccessGrant.findFirst")).toBeLessThan(contact.indexOf("trustedPrisma.customerContact.findUniqueOrThrow"));
    expect(contact).toContain('action: "CONTACT_ACCESS.VIEWED"');
  });
});
