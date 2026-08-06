import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession, getPrimarySupplierCompanyId } from "@/lib/auth/session";
import { PRIVATE_BUCKET } from "@/lib/storage";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { runProductionMonitoringSafely } from "@/lib/monitoring/operational-alerts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession(); if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params; const attachment = await prisma.attachment.findUnique({ where: { id }, include: { quoteRequest: { select: { assignments: { select: { supplierCompanyId: true } } } }, quotation: { select: { supplierCompanyId: true } } } });
  if (!attachment) return NextResponse.json({ error: "File not found" }, { status: 404 });
  if (attachment.scanStatus !== "CLEAN") return NextResponse.json({ error: "This file is still being security checked" }, { status: 423 });
  if (session.user.role !== "ADMINISTRATOR") { const companyId = getPrimarySupplierCompanyId(session); const permitted = companyId && (attachment.quotation?.supplierCompanyId === companyId || attachment.quoteRequest?.assignments.some((a) => a.supplierCompanyId === companyId)); if (!permitted) return NextResponse.json({ error: "File not found" }, { status: 404 }); }
  const previewRequested = new URL(request.url).searchParams.get("preview") === "1";
  const inlinePreview = previewRequested && ["image/jpeg", "image/png"].includes(attachment.mimeType);
  const signed = await getSupabaseAdmin().storage.from(PRIVATE_BUCKET).createSignedUrl(
    attachment.storageKey,
    300,
    inlinePreview ? undefined : { download: attachment.fileName },
  );
  if (!signed.error) await prisma.auditLog.create({ data: { actorUserId: session.userId, supplierCompanyId: getPrimarySupplierCompanyId(session), action: "ATTACHMENT.PRIVILEGED_READ", entityType: "Attachment", entityId: attachment.id, summary: inlinePreview ? "Protected attachment preview signed URL issued" : "Protected attachment download signed URL issued", metadata: { mode: inlinePreview ? "preview" : "download" } } });
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
