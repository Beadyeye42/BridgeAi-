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
    const verifiedUser = read("lib/supabase/verified-user.ts");
    expect(source).toContain("getVerifiedAuthUser()");
    expect(verifiedUser).toContain("supabase.auth.getUser()");
    expect(verifiedUser).toContain("cache(async");
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

  it("limits legacy customer image release to verified administrators and WhatsApp objects", () => {
    const source = read("app/api/admin/attachments/[id]/sanitize/route.ts");
    const guard = source.indexOf("await requireAdminApi()");
    const databaseRead = source.indexOf("prisma.attachment.findUnique");
    const storageRead = source.indexOf("bucket.download");
    expect(guard).toBeGreaterThan(-1);
    expect(databaseRead).toBeGreaterThan(guard);
    expect(storageRead).toBeGreaterThan(databaseRead);
    expect(source).toContain("attachment.whatsappMessageId");
    expect(source).toContain('attachment.storageKey.startsWith("customers/")');
    expect(source).toContain('scanStatus: "CLEAN"');
    expect(source).toContain('action: "ADMIN.CUSTOMER_IMAGE_SANITIZED"');
    expect(source).not.toContain("requireSupplierApi");
  });

  it("authorises private attachment reads before server-only signed URL creation", () => {
    const source = read("app/api/attachments/[id]/download/route.ts");
    const identity = source.indexOf("await getCurrentSession()");
    const attachment = source.indexOf("prisma.attachment.findUnique");
    const companyPermission = source.indexOf("const permitted");
    const signedUrl = source.indexOf("getSupabaseAdmin().storage");
    expect(identity).toBeGreaterThan(-1);
    expect(attachment).toBeGreaterThan(identity);
    expect(companyPermission).toBeGreaterThan(attachment);
    expect(signedUrl).toBeGreaterThan(companyPermission);
    expect(source).toContain('scanStatus !== "CLEAN"');
    expect(source).toContain('code: "ATTACHMENT_SIGNED_URL_FAILED"');
    expect(source).not.toContain("getPrivateStorage");
  });

  it("uses one timestamp for quotation creation and returns structured failures", () => {
    const source = read("app/api/quotations/route.ts");
    expect(source).toContain("const submittedAt = new Date()");
    expect(source).toContain("submittedAt, createdAt: submittedAt");
    expect(source).toContain("respondedAt: submittedAt");
    expect(source).toContain('code: "QUOTATION_SUBMIT_FAILED"');
    expect(source).toContain('NextResponse.json({ error: "The quotation could not be submitted. Please try again." }');
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

    const workerPolicy = read("supabase/migrations/20260804170036_whatsapp_webhook_worker_context.sql");
    expect(workerPolicy).toContain("session_user = 'bridge_ai_app'");
    expect(workerPolicy).toContain("bridge_ai.worker_context");
    expect(workerPolicy).toContain("whatsapp_worker_message_insert");

    const auditWriter = read("supabase/migrations/20260804171036_whatsapp_audit_writer.sql");
    expect(auditWriter).toContain("session_user <> 'bridge_ai_app'");
    expect(auditWriter).toContain("SET row_security = 'off'");
    expect(auditWriter).toContain("audit_action NOT LIKE 'WHATSAPP.%'");
    expect(source).toContain("bridge_private.write_whatsapp_audit");
    expect(source).not.toContain("tx.auditLog.create");
  });

  it("keeps customer display names encrypted in the application schema", () => {
    const schema = read("prisma/schema.prisma");
    const customer = schema.slice(schema.indexOf("model CustomerContact"), schema.indexOf("model Conversation"));
    expect(customer).toMatch(/displayNameEncrypted\s+Bytes\?/);
    expect(customer).toMatch(/preferredFirstNameEncrypted\s+Bytes\?/);
    expect(customer).toMatch(/preferredNameAskedAt\s+DateTime\?/);
    expect(customer).not.toMatch(/\n\s+displayName\s+String/);
    expect(customer).not.toMatch(/\n\s+preferredFirstName\s+String/);

    const migration = read("supabase/migrations/20260806150303_whatsapp_preferred_first_names.sql");
    expect(migration).toContain('ADD COLUMN "preferredFirstNameEncrypted" bytea');
    expect(migration).toContain("'PREFERRED_NAME'");
    const processor = read("lib/whatsapp/processor.ts");
    expect(processor).toContain("encryptPrivateValue(firstName)");
    expect(processor).toContain('action = existing ? "WHATSAPP.PREFERRED_FIRST_NAME_UPDATED" : "WHATSAPP.PREFERRED_FIRST_NAME_SAVED"');
    expect(processor).toContain('action: "WHATSAPP.PREFERRED_FIRST_NAME_REQUESTED"');
    expect(processor).not.toContain("metadata: { messageId: inbound.id, source, firstName");
    expect(processor).toContain("isPreferredNameMessage");
    expect(read("lib/ai/quote-intake.ts")).toContain("always leave draft.customerName null");
  });

  it("cancels only encrypted WhatsApp drafts and preserves confirmed quote requests", () => {
    const processor = read("lib/whatsapp/processor.ts");
    const cancellation = processor.slice(
      processor.indexOf("async function cancelQuoteDrafts"),
      processor.indexOf("async function processInbound"),
    );
    expect(cancellation).toContain("customerContactId: conversation.customerContactId");
    expect(cancellation).toContain("aiDraftEncrypted: null");
    expect(cancellation).toContain('action: allDrafts ? "WHATSAPP.ALL_DRAFTS_CANCELLED" : "WHATSAPP.DRAFT_CANCELLED"');
    expect(cancellation).toContain("submittedRequestsChanged: false");
    expect(cancellation).not.toContain("quoteRequest.update");
    expect(cancellation).not.toContain("quoteRequest.delete");
    expect(processor).toContain("&& !isCancelAllDraftsRequest(body)");
    expect(processor).toContain("&& !isCancelDraftRequest(body)");
  });

  it("keeps WhatsApp AI processing durable, consent-gated and inaccessible to suppliers", () => {
    const migration = read("supabase/migrations/20260804195726_whatsapp_ai_concierge.sql");
    expect(migration).toContain('ALTER TABLE bridge_ai."WhatsAppJob" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain("whatsapp_webhook_job_insert");
    expect(migration).toContain("whatsapp_ai_job_select");
    expect(migration).not.toMatch(/CREATE POLICY .*supplier.*WhatsAppJob/i);
    const processor = read("lib/whatsapp/processor.ts");
    expect(processor).toContain("if (!conversation.aiConsentAt)");
    expect(processor).toContain('stage === "AWAITING_CONFIRMATION" && isQuoteConfirmation(text)');
    expect(processor).toContain("aiSessionStartedAt: sessionStartedAt");
    expect(processor).toContain("sanitizeCustomerImage");
    expect(processor).toContain('scanStatus: "CLEAN"');
    expect(processor).toContain('scanStatus: "PENDING" as const');
    expect(processor).toContain("take: 5");
    const messagingPolicy = read("lib/whatsapp/policy.ts");
    expect(messagingPolicy).toContain("24 * 60 * 60_000");
    expect(processor).toContain("wasReplyRecentlySent");
    expect(processor).toContain("earlier.status IN ('PENDING', 'PROCESSING')");
    expect(processor).toContain("STALE_JOB_EXHAUSTED");
    expect(processor).toContain("quote-summary:${quotation.quoteRequestId}:first");
    expect(processor).toContain("META_QUOTE_TEMPLATE_REQUIRED");
    expect(processor).toContain("META_CONTACT_TEMPLATE_REQUIRED");
    expect(processor).toContain('type: "SEND_INTAKE_FALLBACK"');
    expect(processor).toContain("customerConfirmationMessageId");
    expect(processor).toContain('code: "CUSTOMER_INTAKE_STALLED"');
    expect(processor).toContain("tradeSpecificationClarification");
    expect(processor).toContain("item.specification");
    expect(processor).toContain("writeWhatsAppSystemEvent");
    expect(processor).toContain("CONTACT_UNLOCK_NOT_AUTHORISED");
    expect(processor).toContain('action: "WHATSAPP.NEW_QUOTE_STARTED"');
    expect(processor).toContain("message.occurredAt >= refreshed.conversation!.aiSessionStartedAt");
    expect(processor).toContain("occurredAt: { gte: loaded.conversation!.aiSessionStartedAt }");
    const sessions = read("supabase/migrations/20260805020238_whatsapp_quote_sessions.sql");
    expect(sessions).toContain('ADD COLUMN "aiSessionStartedAt"');
    expect(sessions).toContain('ALTER COLUMN "aiSessionStartedAt" SET NOT NULL');
    expect(read("lib/whatsapp/meta-client.ts")).toContain('type: "template"');
    expect(processor).not.toContain("supplierCompany.tradingName");
    const ai = read("lib/ai/quote-intake.ts");
    expect(ai).toContain("store: false");
    expect(ai).toContain('type: "json_schema"');
    expect(ai).toContain("safety_identifier");
    expect(ai).toContain("nextQuestionKey");
    expect(ai).toContain("tradeClarification");
    expect(ai).toContain("For olive");
    expect(ai).toContain("RAL/BS code");
    const reliability = read("supabase/migrations/20260805102631_whatsapp_conversation_reliability_constraints.sql");
    expect(reliability).toContain("conversation_ai_question_key_valid");
    expect(reliability).toContain('"customerConfirmationMessageId"');
    expect(reliability).toContain("SEND_INTAKE_FALLBACK");
    const systemEventWriter = read("supabase/migrations/20260805103603_whatsapp_system_event_writer.sql");
    expect(systemEventWriter).toContain("session_user <> 'bridge_ai_app'");
    expect(systemEventWriter).toContain("event_source <> worker_name");
    expect(systemEventWriter).toContain("SET row_security = 'off'");
    expect(systemEventWriter).toContain("TO bridge_ai_app");
    const attachmentAi = read("lib/ai/attachment-intake.ts");
    expect(attachmentAi).toContain("store: false");
    expect(attachmentAi).toContain('type: "input_file"');
    expect(attachmentAi).toContain('type: "input_image"');
    const policyIndex = read("supabase/migrations/20260804195834_whatsapp_job_policy_and_index.sql");
    expect(policyIndex).toContain("whatsapp_job_message_idx");
    expect(policyIndex).toContain("whatsapp_job_insert");
    const returningPolicy = read("supabase/migrations/20260804204515_whatsapp_job_webhook_returning_policy.sql");
    expect(returningPolicy).toContain("DROP POLICY whatsapp_ai_job_select");
    expect(returningPolicy).toContain("CREATE POLICY whatsapp_job_select");
    expect(returningPolicy).toContain("is_trusted_worker('whatsapp_webhook')");
    expect(returningPolicy).toContain("type = 'PROCESS_INBOUND'");
    const unlockWorker = read("supabase/migrations/20260804200717_whatsapp_contact_unlock_worker.sql");
    expect(unlockWorker).toContain("whatsapp_ai_contact_grant_update");
    expect(unlockWorker).toContain("SEND_CONTACT_UNLOCK");
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
    expect(matching).toContain("{ categories: { some: { productCategoryId: request.categoryId } } }");
    expect(matching).toContain("productCategory: { parentId: request.categoryId }");
    expect(matching).toContain("children: { some: { id: request.categoryId } }");
    expect(matching).toContain("bestCoverageMatch");
    expect(matching).toContain("matches.slice(0, options.limit)");
    expect(coverageRoute).toContain('action: "COVERAGE.CREATED"');
  });

  it("allows approved suppliers to browse only a safe opportunity projection and gates claims on membership", () => {
    const migration = read("supabase/migrations/20260805135021_supplier_opportunity_marketplace.sql");
    const claimRoute = read("app/api/opportunities/[reference]/claim/route.ts");
    const listPage = read("app/dashboard/requests/page.tsx");
    const detailPage = read("app/dashboard/requests/[reference]/page.tsx");
    expect(migration).toContain('SupplierOpportunity" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain("supplier_opportunity_approved_read");
    expect(read("supabase/migrations/20260805140640_optimize_supplier_opportunity_policy.sql")).toContain("supplier_opportunity_read");
    expect(migration).toContain("company.status = 'APPROVED'");
    const pendingBrowse = read("supabase/migrations/20260805175617_allow_pending_supplier_opportunity_browsing.sql");
    expect(pendingBrowse).toContain("company.status IN ('PENDING', 'APPROVED')");
    expect(pendingBrowse).not.toContain("'SUSPENDED', 'REJECTED'");
    expect(migration).toContain("ACTIVE_SUBSCRIPTION_REQUIRED");
    expect(read("supabase/migrations/20260805215057_founding_supplier_pricing.sql")).toContain("ACTIVE_FOUNDING_SUBSCRIPTION_REQUIRED");
    expect(migration).toContain("CATEGORY_NOT_MATCHED");
    const simplifiedApproval = read("supabase/migrations/20260805172853_simplify_supplier_company_approval.sql");
    expect(simplifiedApproval).not.toContain("ACCREDITATION_REQUIRED");
    expect(migration).toContain("COVERAGE_NOT_MATCHED");
    expect(migration).toContain("LEAST(request_row.\"distributionLimit\", 5)");
    expect(migration).toContain("OPPORTUNITY.CLAIMED");
    expect(migration).toContain("TO bridge_ai_app");
    expect(migration).not.toMatch(/CREATE POLICY[^;]+SupplierOpportunity[^;]+FOR (INSERT|UPDATE|DELETE)/i);
    const projection = migration.slice(migration.indexOf('CREATE TABLE bridge_ai."SupplierOpportunity"'), migration.indexOf("CREATE INDEX"));
    expect(projection).not.toMatch(/customerContactId|conversationId|summary|deliveryPostcode|customerBudget/);
    expect(claimRoute).toContain("requireSupplierApi()");
    expect(claimRoute).toContain("claim_supplier_opportunity");
    expect(claimRoute).not.toContain("trustedPrisma");
    expect(listPage).toContain("supplierOpportunity.findMany");
    expect(read("lib/data/supplier-dashboard.ts")).toContain("tx.supplierOpportunity.findMany");
    expect(detailPage).toContain("The exact postcode, detailed brief, drawings, photos and PDFs remain locked");
  });

  it("automatically distributes confirmed WhatsApp requests without weakening tenant isolation", () => {
    const processor = read("lib/whatsapp/processor.ts");
    const migration = read("supabase/migrations/20260805130054_whatsapp_auto_distribution.sql");
    expect(processor).toContain("findSupplierMatches(");
    expect(processor).toContain("Math.min(distributionLimit, 5)");
    expect(processor).toContain('action: "WHATSAPP.REQUEST_AUTO_ASSIGNED"');
    expect(processor).toContain("automaticAssignmentCount");
    expect(processor).toContain("awaiting an eligible supplier match");
    expect(migration).toContain("enforce_whatsapp_attachment_quote_consistency");
    expect(migration).toContain('"whatsappMessageId" IS NOT NULL');
    expect(migration).toContain('"quoteRequestId"');
    expect(migration).toContain("whatsapp_ai_assignment_insert");
    expect(migration).toContain("whatsapp_ai_notification_insert");
    expect(migration).toContain("whatsapp_ai_supplier_category_match_select");
    expect(migration).toContain("whatsapp_ai_coverage_match_select");
  });

  it("does not present demonstration counts as live supplier data", () => {
    const sidebar = read("components/dashboard/sidebar.tsx");
    const dashboard = read("components/dashboard/supplier-dashboard.tsx");
    expect(sidebar).not.toContain('badge: "4"');
    expect(sidebar).toContain("statusLabel(companyStatus)");
    expect(dashboard).toContain("data.stats.newRequests > 0");
    expect(dashboard).toContain("data.unreadNotificationCount > 0");
    expect(dashboard).toContain('demo ? "2 added today"');
  });

  it("closes supplier lifecycle and response-window edge cases", () => {
    const decision = read("app/api/assignments/[id]/decision/route.ts");
    expect(decision).toContain("assignment.expiresAt <= new Date()");
    const viewed = read("app/api/assignments/[id]/view/route.ts");
    expect(viewed).toContain('action: "ASSIGNMENT.VIEWED"');
    expect(viewed).toContain('supplierCompanyId: auth.companyId');
    const requests = read("app/dashboard/requests/page.tsx");
    expect(requests).toContain("responseDueAt: { gt: now }");
    expect(requests).toContain("expiresAt: { lte: now }");
    const status = read("app/api/admin/suppliers/[id]/status/route.ts");
    expect(status).toContain("supplierApprovalReadiness(existing)");
    expect(status).toContain('action: `ADMIN.SUPPLIER_${parsed.data.status}`');
    expect(status).not.toContain("supplierTeamMembership.updateMany");
    const team = read("app/dashboard/team/page.tsx");
    expect(team).toContain('memberships:{where:{status:"ACTIVE"}');
  });

  it("enforces supplier approval readiness and limits administrator recovery actions", () => {
    const migration = read("supabase/migrations/20260805172853_simplify_supplier_company_approval.sql");
    const triggerFix = read("supabase/migrations/20260805180031_restore_supplier_review_trigger_security_definer.sql");
    expect(migration).toContain("enforce_supplier_review_state");
    expect(migration).toContain("supplier review state can only be changed by a platform administrator");
    expect(migration).toContain("supplier approval requirements are incomplete");
    expect(migration).toContain("bridge_private.is_platform_admin()");
    expect(triggerFix).toContain("ALTER FUNCTION bridge_private.enforce_supplier_review_state() SECURITY DEFINER");
    expect(triggerFix).toContain("FROM PUBLIC, anon, authenticated, service_role");
    const retry = read("app/api/admin/system/jobs/[id]/retry/route.ts");
    expect(retry).toContain("await requireAdminApi()");
    expect(retry).toContain('existing.status !== "FAILED"');
    expect(retry).toContain('existing.errorCode === "OUTBOUND_DELIVERY_UNCERTAIN"');
    expect(retry).toContain("whatsAppJob.updateMany");
    expect(retry).toContain('where: { id, status: "FAILED", errorCode: { not: "OUTBOUND_DELIVERY_UNCERTAIN" } }');
    expect(retry).toContain('action: "ADMIN.WHATSAPP_JOB_RETRIED"');
    expect(retry).toContain("processWhatsAppJobs({ limit: 20 })");
    const matching = read("lib/matching/suppliers.ts");
    expect(matching).toContain("supplierOnboardingReadiness(supplier).ready");
    expect(matching).not.toContain("accreditations:");
  });

  it("keeps browser location lookup authenticated and non-persistent", () => {
    const source = read("app/api/supplier/location/postcode/route.ts");
    expect(source.indexOf("requireSupplierApi()")).toBeGreaterThan(-1);
    expect(source.indexOf("requireSupplierApi()")).toBeLessThan(source.indexOf("postcodeFromCoordinates("));
    expect(source).not.toMatch(/prisma\.|trustedPrisma|writeAuditLog/);
  });

  it("unlocks customer contact only through the server-controlled selection transaction", () => {
    const webhook = read("app/api/webhooks/stripe/route.ts");
    const handler = webhook.slice(webhook.indexOf("export async function POST"));
    expect(handler.indexOf("constructEvent(")).toBeGreaterThan(-1);
    expect(handler.indexOf("constructEvent(")).toBeLessThan(handler.indexOf("processEvent(event)"));
    expect(webhook).not.toContain("success_fee");
    expect(webhook).not.toContain("await request.json()");
    const migration = read("supabase/migrations/20260805215057_founding_supplier_pricing.sql");
    expect(migration).toContain("customer selection transitions are server controlled");
    expect(migration).toContain("accepted quotation requires a matching contact grant");
    expect(migration).toContain("CUSTOMER_SELECTED");
    const selection = read("lib/quotes/selection.ts");
    expect(selection).toContain('reason: "CUSTOMER_SELECTED"');
    expect(selection).toContain('action: "CONTACT_ACCESS.GRANTED"');
    expect(selection.indexOf("contactAccessGrant.create")).toBeLessThan(selection.indexOf('status: "ACCEPTED"'));
    const contact = read("lib/contacts/access.ts");
    expect(contact.indexOf("prisma.contactAccessGrant.findFirst")).toBeLessThan(contact.indexOf("trustedPrisma.customerContact.findUniqueOrThrow"));
    expect(contact).toContain('action: "CONTACT_ACCESS.VIEWED"');
  });
});
