import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { notificationPreferenceSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(request: Request) {
  const auth = await requireSupplierApi(); if ("error" in auth) return auth.error;
  const parsed = notificationPreferenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  await prisma.$transaction(async (tx) => {
    await tx.notificationPreference.upsert({ where: { userId_supplierCompanyId: { userId: auth.session.userId, supplierCompanyId: auth.companyId } }, update: parsed.data, create: { ...parsed.data, userId: auth.session.userId, supplierCompanyId: auth.companyId } });
    await writeAuditLog({ actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "NOTIFICATIONS.PREFERENCES_UPDATED", entityType: "NotificationPreference", summary: "Notification preferences updated", request }, tx);
  });
  return NextResponse.json({ ok: true });
}
