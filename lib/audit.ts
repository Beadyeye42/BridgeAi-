import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

type AuditClient = Pick<PrismaClient, "auditLog"> | Pick<Prisma.TransactionClient, "auditLog">;

export async function writeAuditLog(
  entry: {
    actorUserId?: string;
    supplierCompanyId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    summary: string;
    metadata?: Prisma.InputJsonValue;
    request?: Request;
  },
  client: AuditClient = prisma,
) {
  return client.auditLog.create({
    data: {
      actorUserId: entry.actorUserId,
      supplierCompanyId: entry.supplierCompanyId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      metadata: entry.metadata,
      ipAddress: entry.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: entry.request?.headers.get("user-agent"),
    },
  });
}
