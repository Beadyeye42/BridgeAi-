import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession, getPrimarySupplierCompanyId } from "@/lib/auth/session";
import { PRIVATE_BUCKET } from "@/lib/storage";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { runProductionMonitoringSafely } from "@/lib/monitoring/operational-alerts";
import { canReadSupplierAssignment } from "@/lib/billing/opportunity-access";
import { getBuyerSession } from "@/lib/buyer/session";
import { runAsDatabaseWorker } from "@/lib/db";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  const buyerSession = session ? null : await getBuyerSession();
  if (!session && !buyerSession) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  if (buyerSession) return downloadBuyerAttachment(request, id, buyerSession);
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const companyId = getPrimarySupplierCompanyId(session);
  const attachment = await prisma.attachment.findUnique({
    where: { id },
    include: {
      quoteRequest: {
        select: {
          deliveryLatitude: true,
          deliveryLongitude: true,
          fulfilmentMode: true,
          assignments: {
            where: companyId ? { supplierCompanyId: companyId } : undefined,
            select: { supplierCompanyId: true, quotation: { select: { id: true } } },
          },
        },
      },
      quotation: { select: { supplierCompanyId: true } },
    },
  });
  if (!attachment) return NextResponse.json({ error: "File not found" }, { status: 404 });
  if (attachment.scanStatus !== "CLEAN") return NextResponse.json({ error: "This file is still being security checked" }, { status: 423 });
  if (session.user.role !== "ADMINISTRATOR") {
    if (!companyId) return NextResponse.json({ error: "File not found" }, { status: 404 });
    const company = await prisma.supplierCompany.findUnique({
      where: { id: companyId },
      include: { subscription: { include: { membershipPlan: true } } },
    });
    const assignment = attachment.quoteRequest?.assignments[0];
    const permitted = attachment.quotation?.supplierCompanyId === companyId
      || Boolean(company && assignment && attachment.quoteRequest && canReadSupplierAssignment(company, {
        quotation: assignment.quotation,
        quoteRequest: attachment.quoteRequest,
      }));
    if (!permitted) return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  const previewRequested = new URL(request.url).searchParams.get("preview") === "1";
  const inlinePreview = previewRequested && ["image/jpeg", "image/png"].includes(attachment.mimeType);
  const signed = await getSupabaseAdmin().storage.from(PRIVATE_BUCKET).createSignedUrl(
    attachment.storageKey,
    300,
    inlinePreview ? undefined : { download: attachment.fileName },
  );
  if (!signed.error) await prisma.auditLog.create({ data: { actorUserId: session.userId, supplierCompanyId: companyId, action: "ATTACHMENT.PRIVILEGED_READ", entityType: "Attachment", entityId: attachment.id, summary: inlinePreview ? "Protected attachment preview signed URL issued" : "Protected attachment download signed URL issued", metadata: { mode: inlinePreview ? "preview" : "download" } } });
  if (signed.error) {
    await prisma.systemEvent.create({ data: { severity: "ERROR", source: "storage", code: "ATTACHMENT_SIGNED_URL_FAILED", message: signed.error.message.slice(0, 1000), context: { attachmentId: attachment.id } } }).catch(() => undefined);
    after(runProductionMonitoringSafely);
    return NextResponse.json({ error: "File is temporarily unavailable" }, { status: 503 });
  }
  const response = NextResponse.redirect(signed.data.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function downloadBuyerAttachment(
  request: Request,
  id: string,
  buyerSession: NonNullable<Awaited<ReturnType<typeof getBuyerSession>>>,
) {
  const attachment = await runAsDatabaseWorker("buyer_auth", (tx) => tx.attachment.findFirst({
    where: { id, scanStatus: "CLEAN", quoteRequest: { customerContactId: buyerSession.buyer.id } },
    select: { id: true, storageKey: true, fileName: true, mimeType: true },
  }));
  if (!attachment) return NextResponse.json({ error: "File not found" }, { status: 404 });
  const previewRequested = new URL(request.url).searchParams.get("preview") === "1";
  const inlinePreview = previewRequested && ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(attachment.mimeType);
  const signed = await getSupabaseAdmin().storage.from(PRIVATE_BUCKET).createSignedUrl(
    attachment.storageKey,
    300,
    inlinePreview ? undefined : { download: attachment.fileName },
  );
  if (signed.error) {
    await runAsDatabaseWorker("buyer_auth", (tx) => tx.buyerSecurityEvent.create({
      data: { customerContactId: buyerSession.buyer.id, authUserId: buyerSession.user.id, eventType: "BUYER_ATTACHMENT_SIGN_FAILED", metadata: { attachmentId: attachment.id } },
    })).catch(() => undefined);
    return NextResponse.json({ error: "File is temporarily unavailable" }, { status: 503 });
  }
  await runAsDatabaseWorker("buyer_auth", (tx) => tx.buyerSecurityEvent.create({
    data: { customerContactId: buyerSession.buyer.id, authUserId: buyerSession.user.id, eventType: "BUYER_ATTACHMENT_READ", metadata: { attachmentId: attachment.id, mode: inlinePreview ? "preview" : "download" } },
  })).catch(() => undefined);
  const response = NextResponse.redirect(signed.data.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
