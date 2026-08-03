import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { getPrivateStorage, PRIVATE_BUCKET } from "@/lib/storage";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const auth = await requireSupplierApi(); if ("error" in auth) return auth.error;
  const form = await request.formData(); const quotationId = String(form.get("quotationId") ?? ""); const file = form.get("file");
  if (!(file instanceof File) || file.type !== "application/pdf" || file.size < 1 || file.size > MAX_BYTES) return NextResponse.json({ error: "Attach a PDF no larger than 10 MB" }, { status: 400 });
  const quotation = await prisma.supplierQuotation.findFirst({ where: { id: quotationId, supplierCompanyId: auth.companyId, status: "SUBMITTED" } });
  if (!quotation) return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
  const bytes = Buffer.from(await file.arrayBuffer()); const sha256 = createHash("sha256").update(bytes).digest("hex"); const storageKey = `companies/${auth.companyId}/quotations/${quotation.id}/${randomUUID()}.pdf`;
  try {
    const supabase = await getPrivateStorage();
    const uploaded = await supabase.storage.from(PRIVATE_BUCKET).upload(storageKey, bytes, { contentType: "application/pdf", cacheControl: "3600", upsert: false });
    if (uploaded.error) throw uploaded.error;
    const attachment = await prisma.$transaction(async (tx) => {
      const saved = await tx.attachment.create({ data: { kind: "QUOTATION_PDF", fileName: file.name.slice(0, 255), mimeType: file.type, byteSize: file.size, storageKey, sha256, scanStatus: "PENDING", quotationId: quotation.id, uploadedById: auth.session.userId } });
      await writeAuditLog({ actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "ATTACHMENT.UPLOADED", entityType: "Attachment", entityId: saved.id, summary: "Quotation PDF uploaded and queued for security scanning", request }, tx); return saved;
    });
    return NextResponse.json({ ok: true, attachmentId: attachment.id, scanStatus: attachment.scanStatus }, { status: 201 });
  } catch (error) {
    await prisma.systemEvent.create({ data: { severity: "ERROR", source: "storage", code: "QUOTATION_UPLOAD_FAILED", message: error instanceof Error ? error.message.slice(0, 1000) : "Quotation upload failed", context: { quotationId, supplierCompanyId: auth.companyId } } }).catch(() => undefined);
    return NextResponse.json({ error: "The PDF could not be stored. Your quotation remains submitted; try the upload again." }, { status: 503 });
  }
}
