import { after, NextResponse } from "next/server";
import { prisma, runAsDatabaseWorker } from "@/lib/db";
import { getCurrentSession, getPrimarySupplierCompanyId } from "@/lib/auth/session";
import { quotationSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { enqueueQuoteSummary, processWhatsAppJobs } from "@/lib/whatsapp/processor";
import { isMembershipActive } from "@/lib/billing/pricing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session || session.user.role !== "SUPPLIER") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const companyId = getPrimarySupplierCompanyId(session);
  if (!companyId) return NextResponse.json({ error: "No supplier company membership" }, { status: 403 });
  const parsed = quotationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  if (parsed.data.validUntil && parsed.data.validUntil <= new Date()) return NextResponse.json({ error: "Quotation validity must end in the future" }, { status: 400 });

  const assignment = await prisma.supplierAssignment.findFirst({
    where: { id: parsed.data.assignmentId, supplierCompanyId: companyId, status: "ACCEPTED", expiresAt: { gt: new Date() } },
    include: { quoteRequest: { select: { status: true, responseDueAt: true } } },
  });
  if (!assignment) return NextResponse.json({ error: "Accepted request not found or response window has closed" }, { status: 404 });
  if (!["OPEN", "MATCHING", "QUOTED"].includes(assignment.quoteRequest.status) || assignment.quoteRequest.responseDueAt <= new Date()) {
    return NextResponse.json({ error: "This request has closed and can no longer receive quotations" }, { status: 409 });
  }
  const company = await prisma.supplierCompany.findUnique({ where: { id: companyId }, select: { status: true } });
  const subscription = await prisma.subscription.findUnique({ where: { supplierCompanyId: companyId } });
  if (!company || company.status !== "APPROVED") return NextResponse.json({ error: "An approved supplier account is required before submitting a quotation" }, { status: 403 });
  if (!isMembershipActive(subscription)) {
    return NextResponse.json({
      error: "Your Bridge AI membership is not active. Renew your membership to submit quotations.",
      code: "MEMBERSHIP_REQUIRED",
      actionUrl: "/dashboard/subscription",
    }, { status: 402 });
  }

  const submittedAt = new Date();
  let quotation;
  try {
    quotation = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bridge_ai."QuoteRequest" WHERE id = ${assignment.quoteRequestId} FOR UPDATE`;
      const currentAssignment = await tx.supplierAssignment.findFirst({
        where: { id: assignment.id, supplierCompanyId: companyId },
        include: { quoteRequest: { select: { status: true, responseDueAt: true } } },
      });
      if (!currentAssignment || currentAssignment.status !== "ACCEPTED" || currentAssignment.expiresAt <= submittedAt) {
        throw new Error("ASSIGNMENT_CLOSED");
      }
      if (!["OPEN", "MATCHING", "QUOTED"].includes(currentAssignment.quoteRequest.status) || currentAssignment.quoteRequest.responseDueAt <= submittedAt) {
        throw new Error("REQUEST_CLOSED");
      }
      const saved = await tx.supplierQuotation.upsert({
        where: { assignmentId: assignment.id },
        update: { price: parsed.data.price, leadTimeDays: parsed.data.leadTimeDays, validUntil: parsed.data.validUntil, notes: parsed.data.notes, status: "SUBMITTED", submittedAt },
        create: { quoteRequestId: assignment.quoteRequestId, supplierCompanyId: companyId, assignmentId: assignment.id, price: parsed.data.price, leadTimeDays: parsed.data.leadTimeDays, validUntil: parsed.data.validUntil, notes: parsed.data.notes, status: "SUBMITTED", submittedAt, createdAt: submittedAt },
      });
      await tx.supplierAssignment.update({ where: { id: assignment.id }, data: { status: "QUOTED", respondedAt: submittedAt } });
      await writeAuditLog({ actorUserId: session.userId, supplierCompanyId: companyId, action: "QUOTATION.SUBMITTED", entityType: "SupplierQuotation", entityId: saved.id, summary: "Supplier quotation submitted", metadata: { price: parsed.data.price, leadTimeDays: parsed.data.leadTimeDays }, request }, tx);
      return saved;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("REQUEST_CLOSED") || message.includes("QUOTE_REQUEST_CLOSED") || message.includes("ASSIGNMENT_CLOSED") || message.includes("QUOTATION_ASSIGNMENT_NOT_FOUND")) {
      return NextResponse.json({ error: "This request has closed and can no longer receive quotations" }, { status: 409 });
    }
    if (message.includes("ACTIVE_MEMBERSHIP_REQUIRED") || message.includes("active geographic supplier membership")) {
      return NextResponse.json({
        error: "Your Bridge AI membership ended before this quotation was submitted. Renew your membership to continue.",
        code: "MEMBERSHIP_REQUIRED",
        actionUrl: "/dashboard/subscription",
      }, { status: 402 });
    }
    console.error("Quotation submission failed", { assignmentId: assignment.id, error });
    await runAsDatabaseWorker("production_monitoring", (tx) => tx.systemEvent.create({ data: { severity: "ERROR", source: "quotation", code: "QUOTATION_SUBMIT_FAILED", message: error instanceof Error ? error.message.slice(0, 1000) : "Quotation submission failed", context: { assignmentId: assignment.id, supplierCompanyId: companyId } } })).catch(() => undefined);
    return NextResponse.json({ error: "The quotation could not be submitted. Please try again." }, { status: 500 });
  }
  after(async () => {
    try {
      const job = await enqueueQuoteSummary(quotation.id);
      if (job) await processWhatsAppJobs({ limit: 5 });
    } catch {
      console.error("Customer quote-summary scheduling failed", { quotationId: quotation.id });
    }
  });
  return NextResponse.json({ ok: true, quotationId: quotation.id }, { status: 201 });
}
