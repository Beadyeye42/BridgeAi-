import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { writeAuditLog } from "@/lib/audit";
import { processWhatsAppJobs } from "@/lib/whatsapp/processor";

export const runtime = "nodejs";

class RetryConflictError extends Error {}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const existing = await prisma.whatsAppJob.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "WhatsApp job not found" }, { status: 404 });
  if (existing.status !== "FAILED") return NextResponse.json({ error: "Only failed jobs can be retried" }, { status: 409 });
  if (existing.errorCode === "OUTBOUND_DELIVERY_UNCERTAIN") {
    return NextResponse.json({ error: "Automatic retry is blocked because the previous message may already have been delivered. Review it manually." }, { status: 409 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.whatsAppJob.updateMany({
        where: { id, status: "FAILED", errorCode: { not: "OUTBOUND_DELIVERY_UNCERTAIN" } },
        data: {
          status: "PENDING",
          attempts: 0,
          availableAt: new Date(),
          lockedAt: null,
          completedAt: null,
          failedAt: null,
          errorCode: null,
        },
      });
      if (updated.count !== 1) throw new RetryConflictError("The job was already retried or changed by another administrator");
      await writeAuditLog({
        actorUserId: auth.session.userId,
        action: "ADMIN.WHATSAPP_JOB_RETRIED",
        entityType: "WhatsAppJob",
        entityId: id,
        summary: `Administrator retried failed WhatsApp job ${existing.type}`,
        metadata: { previousErrorCode: existing.errorCode, previousAttempts: existing.attempts },
        request,
      }, tx);
    });
  } catch (error) {
    if (error instanceof RetryConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }

  await processWhatsAppJobs({ limit: 20 });
  const refreshed = await prisma.whatsAppJob.findUniqueOrThrow({ where: { id }, select: { status: true, errorCode: true } });
  return NextResponse.json({ ok: true, status: refreshed.status, errorCode: refreshed.errorCode });
}
