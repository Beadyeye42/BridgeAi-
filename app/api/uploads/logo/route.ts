import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { getPrivateStorage, PRIVATE_BUCKET } from "@/lib/storage";
import { writeAuditLog } from "@/lib/audit";

const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const form = await request.formData();
  const file = form.get("file");
  if (
    !(file instanceof File) ||
    !allowed.has(file.type) ||
    file.size < 1 ||
    file.size > MAX_BYTES
  ) {
    return NextResponse.json(
      { error: "Choose a PNG, JPEG or WebP image no larger than 2 MB" },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const storageKey = `companies/${auth.companyId}/logos/current`;
  let attachmentId: string | undefined;
  try {
    const company = await prisma.supplierCompany.findUniqueOrThrow({
      where: { id: auth.companyId },
      select: { logoUrl: true },
    });
    // Mark the deterministic object as pending before replacing its bytes. If
    // Storage succeeds but a later operation fails, an older CLEAN metadata
    // row can never make the unscanned replacement downloadable.
    const attachment = await prisma.$transaction(async (tx) => {
      const existing = await tx.attachment.findUnique({
        where: { storageKey },
        select: { id: true },
      });
      if (existing) await tx.attachment.delete({ where: { id: existing.id } });
      const saved = await tx.attachment.create({
        data: {
          kind: "SUPPLIER_LOGO",
          fileName: file.name.slice(0, 255),
          mimeType: file.type,
          byteSize: file.size,
          storageKey,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          scanStatus: "PENDING",
          supplierCompanyId: auth.companyId,
          uploadedById: auth.session.userId,
        },
      });
      await tx.supplierCompany.update({
        where: { id: auth.companyId },
        data: { logoUrl: storageKey },
      });
      return saved;
    });
    attachmentId = attachment.id;

    const supabase = await getPrivateStorage();
    const uploaded = await supabase.storage
      .from(PRIVATE_BUCKET)
      .upload(storageKey, bytes, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: true,
      });
    if (uploaded.error) throw uploaded.error;

    await writeAuditLog({
      actorUserId: auth.session.userId,
      supplierCompanyId: auth.companyId,
      action: company.logoUrl
        ? "SUPPLIER.LOGO_REPLACED"
        : "SUPPLIER.LOGO_UPLOADED",
      entityType: "Attachment",
      entityId: attachment.id,
      summary: company.logoUrl
        ? "Supplier logo replaced and queued for security scanning"
        : "Supplier logo uploaded and queued for security scanning",
      request,
    });

    if (company.logoUrl && company.logoUrl !== storageKey) {
      await supabase.storage.from(PRIVATE_BUCKET).remove([company.logoUrl]);
    }
    return NextResponse.json(
      {
        ok: true,
        attachmentId: attachment.id,
        scanStatus: attachment.scanStatus,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Supplier logo upload failed", error);
    await writeAuditLog({
      actorUserId: auth.session.userId,
      supplierCompanyId: auth.companyId,
      action: "SUPPLIER.LOGO_UPLOAD_FAILED",
      entityType: "Attachment",
      entityId: attachmentId,
      summary: "Supplier logo upload failed",
      request,
    }).catch(() => undefined);
    return NextResponse.json(
      { error: "The logo could not be stored. Try again later." },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const company = await prisma.supplierCompany.findUnique({
    where: { id: auth.companyId },
    select: { logoUrl: true },
  });
  if (!company?.logoUrl)
    return NextResponse.json(
      { error: "No company logo exists" },
      { status: 404 },
    );

  const storage = (await getPrivateStorage()).storage.from(PRIVATE_BUCKET);
  const removed = await storage.remove([company.logoUrl]);
  if (removed.error)
    return NextResponse.json(
      { error: "The logo could not be deleted" },
      { status: 503 },
    );

  await prisma.$transaction(async (tx) => {
    const attachment = await tx.attachment.findUnique({
      where: { storageKey: company.logoUrl! },
      select: { id: true },
    });
    await tx.supplierCompany.update({
      where: { id: auth.companyId },
      data: { logoUrl: null },
    });
    if (attachment)
      await tx.attachment.delete({ where: { id: attachment.id } });
    await writeAuditLog(
      {
        actorUserId: auth.session.userId,
        supplierCompanyId: auth.companyId,
        action: "SUPPLIER.LOGO_DELETED",
        entityType: "Attachment",
        entityId: attachment?.id,
        summary: "Supplier logo deleted",
        request,
      },
      tx,
    );
  });
  return NextResponse.json({ ok: true });
}
