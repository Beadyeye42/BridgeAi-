import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { writeAuditLog } from "@/lib/audit";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), affiliateId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("mark_paid"), payoutId: z.string().min(1).max(64), paymentReference: z.string().trim().min(2).max(160) }),
]);

export async function POST(request: Request) {
  const auth = await requireAdminApi(); if ("error" in auth) return auth.error;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter valid payout details." }, { status: 400 });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      if (parsed.data.action === "mark_paid") {
        const payout = await tx.affiliatePayout.findUniqueOrThrow({ where: { id: parsed.data.payoutId }, include: { items: true } });
        if (payout.status === "PAID") return payout;
        await tx.affiliateCommission.updateMany({ where: { id: { in: payout.items.map((item) => item.commissionId) }, status: "SCHEDULED" }, data: { status: "PAID", paidAt: now } });
        const saved = await tx.affiliatePayout.update({ where: { id: payout.id }, data: { status: "PAID", paidAt: now, paymentReference: parsed.data.paymentReference } });
        await tx.affiliateNotification.create({ data: { affiliateId: payout.affiliateId, type: "PAYOUT_PAID", title: "Affiliate payout paid", body: `Statement ${payout.statementReference} has been marked paid.`, actionUrl: "/affiliate/payouts" } });
        await tx.affiliateAuditLog.create({ data: { affiliateId: payout.affiliateId, actorUserId: auth.session.userId, action: "ADMIN.AFFILIATE_PAYOUT_PAID", entityType: "AffiliatePayout", entityId: payout.id, summary: `Payout ${payout.statementReference} marked paid`, metadata: { paymentReference: parsed.data.paymentReference, amountPaidPence: payout.amountPaidPence } } });
        await writeAuditLog({ actorUserId: auth.session.userId, action: "ADMIN.AFFILIATE_PAYOUT_PAID", entityType: "AffiliatePayout", entityId: payout.id, summary: `Affiliate payout ${payout.statementReference} marked paid`, request }, tx);
        return saved;
      }
      await tx.affiliateCommission.updateMany({ where: { affiliateId: parsed.data.affiliateId, status: { in: ["PENDING", "ADJUSTMENT_PENDING"] }, validationAt: { lte: now } }, data: { status: "AVAILABLE", validatedAt: now } });
      const available = await tx.affiliateCommission.findMany({ where: { affiliateId: parsed.data.affiliateId, status: "AVAILABLE", payoutItem: null }, orderBy: { earnedAt: "asc" } });
      if (!available.length) throw new Error("NO_AVAILABLE_COMMISSION");
      const periodStart = available[0].earnedAt; const periodEnd = available[available.length - 1].earnedAt;
      const positive = available.filter((entry) => entry.commissionAmountPence > 0).reduce((sum, entry) => sum + entry.commissionAmountPence, 0);
      const negative = available.filter((entry) => entry.commissionAmountPence < 0).reduce((sum, entry) => sum + entry.commissionAmountPence, 0);
      const amountPaid = positive + negative;
      if (amountPaid <= 0) throw new Error("NO_POSITIVE_BALANCE");
      const statementReference = `AFF-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const payout = await tx.affiliatePayout.create({ data: {
        affiliateId: parsed.data.affiliateId,
        statementReference,
        periodStart,
        periodEnd,
        openingPendingBalancePence: 0,
        commissionsEarnedPence: positive,
        reversalsPence: negative,
        adjustmentsPence: negative,
        amountPaidPence: amountPaid,
        closingBalancePence: positive + negative - amountPaid,
        status: "SCHEDULED",
        scheduledAt: now,
        items: { create: available.map((entry) => ({ commissionId: entry.id, amountPence: entry.commissionAmountPence })) },
      } });
      await tx.affiliateCommission.updateMany({ where: { id: { in: available.map((entry) => entry.id) } }, data: { status: "SCHEDULED" } });
      await tx.affiliateNotification.create({ data: { affiliateId: parsed.data.affiliateId, type: "PAYOUT_AVAILABLE", title: "Affiliate payout scheduled", body: `Statement ${statementReference} for ${(amountPaid / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP" })} is scheduled.`, actionUrl: "/affiliate/payouts" } });
      await tx.affiliateAuditLog.create({ data: { affiliateId: parsed.data.affiliateId, actorUserId: auth.session.userId, action: "ADMIN.AFFILIATE_PAYOUT_SCHEDULED", entityType: "AffiliatePayout", entityId: payout.id, summary: `Payout statement ${statementReference} generated`, metadata: { itemCount: available.length, amountPaidPence: amountPaid } } });
      await writeAuditLog({ actorUserId: auth.session.userId, action: "ADMIN.AFFILIATE_PAYOUT_SCHEDULED", entityType: "AffiliatePayout", entityId: payout.id, summary: `Affiliate payout statement ${statementReference} generated`, request }, tx);
      return payout;
    });
    return NextResponse.json({ ok: true, payout: result });
  } catch (cause) {
    const message = cause instanceof Error && cause.message === "NO_AVAILABLE_COMMISSION"
      ? "No commission has completed the validation period yet."
      : cause instanceof Error && cause.message === "NO_POSITIVE_BALANCE"
        ? "Refund and dispute adjustments currently offset the available commission balance."
        : "The payout operation could not be completed.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
