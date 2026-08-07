import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { matchingConfigurationAdminSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(request: Request) {
  const auth = await requireAdminApi(); if ("error" in auth) return auth.error;
  const parsed = matchingConfigurationAdminSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const current = await prisma.matchingConfiguration.findUnique({ where: { id: "default" } });
  if (!current) return NextResponse.json({ error: "Matching configuration is missing" }, { status: 503 });
  const saved = await prisma.$transaction(async (tx) => {
    const configuration = await tx.matchingConfiguration.update({ where: { id: "default" }, data: { ...parsed.data, updatedById: auth.session.userId } });
    await writeAuditLog({ actorUserId: auth.session.userId, action: "ADMIN.MATCHING_CONFIGURATION_UPDATED", entityType: "MatchingConfiguration", entityId: configuration.id, summary: "Geographic and supplier matching controls updated", metadata: parsed.data, request }, tx);
    return configuration;
  });
  return NextResponse.json({ ok: true, configuration: saved });
}
