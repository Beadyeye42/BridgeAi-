import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { writeAuditLog } from "@/lib/audit";
import { sanitizeCustomerImage } from "@/lib/security/customer-image";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PRIVATE_BUCKET } from "@/lib/storage";
import { runProductionMonitoringSafely } from "@/lib/monitoring/operational-alerts";

export const runtime = "nodejs";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"] as const);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  if (attachment.scanStatus === "CLEAN") return NextResponse.json({ ok: true, scanStatus: "CLEAN" });
  if (attachment.scanStatus !== "PENDING") {
    return NextResponse.json({ error: "Only pending images can be safely processed" }, { status: 409 });
  }
  if (!ALLOWED_IMAGE_TYPES.has(attachment.mimeType as "image/jpeg" | "image/png")
      || !attachment.whatsappMessageId
      || !attachment.storageKey.startsWith("customers/")) {
    return NextResponse.json({ error: "This action is limited to WhatsApp customer images" }, { status: 422 });
  }
  if (attachment.byteSize <= 0 || attachment.byteSize > 5_000_000) {
    return NextResponse.json({ error: "The image exceeds the safe processing limit" }, { status: 422 });
  }

  const bucket = getSupabaseAdmin().storage.from(PRIVATE_BUCKET);
  const downloaded = await bucket.download(attachment.storageKey);
  if (downloaded.error) {
    await prisma.systemEvent.create({ data: { severity: "ERROR", source: "attachment", code: "ATTACHMENT_READ_FAILED", message: "A private customer image could not be read for security processing", context: { attachmentId: id } } }).catch(() => undefined);
    after(runProductionMonitoringSafely);
    return NextResponse.json({ error: "The private image could not be read" }, { status: 503 });
  }
  const sourceBytes = new Uint8Array(await downloaded.data.arrayBuffer());
  if (sourceBytes.byteLength > 5_000_000) {
    return NextResponse.json({ error: "The stored image exceeds the safe processing limit" }, { status: 422 });
  }

  let sanitized;
  try {
    sanitized = await sanitizeCustomerImage(
      sourceBytes,
      attachment.mimeType as "image/jpeg" | "image/png",
    );
  } catch {
    await prisma.$transaction(async (tx) => {
      await tx.attachment.updateMany({ where: { id, scanStatus: "PENDING" }, data: { scanStatus: "REJECTED" } });
      await writeAuditLog({
        actorUserId: auth.session.userId,
        action: "ADMIN.CUSTOMER_IMAGE_REJECTED",
        entityType: "Attachment",
        entityId: id,
        summary: "Administrator processing rejected an invalid customer image",
        request,
      }, tx);
    });
    after(runProductionMonitoringSafely);
    return NextResponse.json({ error: "The image could not pass safe decoding" }, { status: 422 });
  }

  const uploaded = await bucket.upload(attachment.storageKey, sanitized.bytes, {
    contentType: sanitized.mimeType,
    cacheControl: "3600",
    upsert: true,
  });
  if (uploaded.error) {
    await prisma.systemEvent.create({ data: { severity: "ERROR", source: "attachment", code: "ATTACHMENT_WRITE_FAILED", message: "A safely rebuilt customer image could not be stored", context: { attachmentId: id } } }).catch(() => undefined);
    after(runProductionMonitoringSafely);
    return NextResponse.json({ error: "The safe image could not be stored" }, { status: 503 });
  }

  const sha256 = createHash("sha256").update(sanitized.bytes).digest("hex");
  await prisma.$transaction(async (tx) => {
    await tx.attachment.update({
      where: { id },
      data: { byteSize: sanitized.bytes.byteLength, sha256, scanStatus: "CLEAN" },
    });
    await writeAuditLog({
      actorUserId: auth.session.userId,
      action: "ADMIN.CUSTOMER_IMAGE_SANITIZED",
      entityType: "Attachment",
      entityId: id,
      summary: "Administrator safely rebuilt a legacy WhatsApp customer image",
      metadata: { byteSize: sanitized.bytes.byteLength, mimeType: sanitized.mimeType },
      request,
    }, tx);
  });

  return NextResponse.json({ ok: true, scanStatus: "CLEAN" });
}
