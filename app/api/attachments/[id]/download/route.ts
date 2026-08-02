import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentSession, getPrimarySupplierCompanyId } from "@/lib/auth/session";
import { getPrivateStorage, PRIVATE_BUCKET } from "@/lib/storage";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession(); if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params; const attachment = await prisma.attachment.findUnique({ where: { id }, include: { quoteRequest: { select: { assignments: { select: { supplierCompanyId: true } } } }, quotation: { select: { supplierCompanyId: true } } } });
  if (!attachment) return NextResponse.json({ error: "File not found" }, { status: 404 });
  if (attachment.scanStatus !== "CLEAN") return NextResponse.json({ error: "This file is still being security checked" }, { status: 423 });
  if (session.user.role !== "ADMINISTRATOR") { const companyId = getPrimarySupplierCompanyId(session); const permitted = companyId && (attachment.quotation?.supplierCompanyId === companyId || attachment.quoteRequest?.assignments.some((a) => a.supplierCompanyId === companyId)); if (!permitted) return NextResponse.json({ error: "File not found" }, { status: 404 }); }
  const signed = await (await getPrivateStorage()).storage.from(PRIVATE_BUCKET).createSignedUrl(attachment.storageKey, 300, { download: attachment.fileName });
  if (!signed.error) await prisma.auditLog.create({ data: { actorUserId: session.userId, supplierCompanyId: getPrimarySupplierCompanyId(session), action: "ATTACHMENT.PRIVILEGED_READ", entityType: "Attachment", entityId: attachment.id, summary: "Protected attachment signed URL issued" } });
  if (signed.error) return NextResponse.json({ error: "File is temporarily unavailable" }, { status: 503 });
  return NextResponse.redirect(signed.data.signedUrl);
}
