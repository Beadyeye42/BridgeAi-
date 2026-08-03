import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { accreditationUploadSchema, validationError } from "@/lib/auth/validation";
import { getPrivateStorage, PRIVATE_BUCKET } from "@/lib/storage";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function date(value: string | null) {
  return value ? new Date(`${value}T12:00:00.000Z`) : null;
}

export async function POST(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const membership = auth.session.user.memberships.find((item) => item.supplierCompanyId === auth.companyId);
  if (!membership || !["OWNER", "MANAGER"].includes(membership.role)) {
    return NextResponse.json({ error: "Owner or manager access required" }, { status: 403 });
  }

  const form = await request.formData();
  const parsed = accreditationUploadSchema.safeParse({
    type: form.get("type"),
    displayName: form.get("displayName"),
    referenceNumber: form.get("referenceNumber") ?? "",
    issuingBody: form.get("issuingBody") ?? "",
    issuedAt: form.get("issuedAt") ?? "",
    expiresAt: form.get("expiresAt") ?? "",
  });
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_BYTES || !ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Attach a PDF, PNG, JPEG or WebP file no larger than 10 MB" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `companies/${auth.companyId}/accreditations/${randomUUID()}.${ALLOWED_TYPES.get(file.type)}`;
  const storage = await getPrivateStorage();
  const uploaded = await storage.storage.from(PRIVATE_BUCKET).upload(storageKey, bytes, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploaded.error) return NextResponse.json({ error: "The document could not be stored" }, { status: 503 });

  try {
    const accreditation = await prisma.$transaction(async (tx) => {
      const attachment = await tx.attachment.create({
        data: {
          kind: "ACCREDITATION_DOCUMENT",
          fileName: file.name.slice(0, 255),
          mimeType: file.type,
          byteSize: file.size,
          storageKey,
          sha256,
          scanStatus: "PENDING",
          supplierCompanyId: auth.companyId,
          uploadedById: auth.session.userId,
        },
      });
      const saved = await tx.supplierAccreditation.create({
        data: {
          supplierCompanyId: auth.companyId,
          attachmentId: attachment.id,
          type: parsed.data.type,
          displayName: parsed.data.displayName,
          referenceNumber: parsed.data.referenceNumber,
          issuingBody: parsed.data.issuingBody,
          issuedAt: date(parsed.data.issuedAt),
          expiresAt: date(parsed.data.expiresAt),
          createdById: auth.session.userId,
        },
      });
      await writeAuditLog({
        actorUserId: auth.session.userId,
        supplierCompanyId: auth.companyId,
        action: "ACCREDITATION.UPLOADED",
        entityType: "SupplierAccreditation",
        entityId: saved.id,
        summary: "Supplier accreditation document uploaded for review",
        metadata: { type: parsed.data.type, scanStatus: "PENDING" },
        request,
      }, tx);
      return saved;
    });
    return NextResponse.json({ ok: true, accreditationId: accreditation.id, scanStatus: "PENDING" }, { status: 201 });
  } catch (error) {
    await storage.storage.from(PRIVATE_BUCKET).remove([storageKey]).catch(() => undefined);
    console.error("Accreditation metadata creation failed", error);
    return NextResponse.json({ error: "The document could not be recorded" }, { status: 500 });
  }
}
