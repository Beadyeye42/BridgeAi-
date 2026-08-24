import { BuyerPortalStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { requireAdminApi } from "@/lib/auth/api";
import { prisma } from "@/lib/db";

const schema = z.object({ status: z.nativeEnum(BuyerPortalStatus) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid buyer status" }, { status: 400 });
  const { id } = await params;
  const buyer = await prisma.customerContact.findUnique({ where: { id }, select: { id: true, buyerAuthUserId: true, buyerPortalStatus: true } });
  if (!buyer?.buyerAuthUserId) return NextResponse.json({ error: "Buyer Hub account not found" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.customerContact.update({ where: { id }, data: { buyerPortalStatus: parsed.data.status } });
    if (parsed.data.status === "SUSPENDED") {
      await tx.buyerLoginChallenge.updateMany({ where: { customerContactId: id, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.buyerTrustedSession.updateMany({ where: { customerContactId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await tx.buyerSecurityEvent.create({
      data: { customerContactId: id, authUserId: buyer.buyerAuthUserId, eventType: `ADMIN_BUYER_${parsed.data.status}`, metadata: { previousStatus: buyer.buyerPortalStatus, actorUserId: auth.session.userId } },
    });
    await writeAuditLog({ actorUserId: auth.session.userId, action: `ADMIN.BUYER_${parsed.data.status}`, entityType: "CustomerContact", entityId: id, summary: `Buyer Hub access ${parsed.data.status === "ACTIVE" ? "restored" : "suspended"}`, metadata: { previousStatus: buyer.buyerPortalStatus }, request }, tx);
  });
  return NextResponse.json({ ok: true, status: parsed.data.status });
}
