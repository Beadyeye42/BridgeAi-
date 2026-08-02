import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { coverageAreaSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: Request) {
  const auth = await requireSupplierApi(); if ("error" in auth) return auth.error;
  const parsed = coverageAreaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const area = await prisma.$transaction(async (tx) => {
    const saved = await tx.coverageArea.create({ data: { supplierCompanyId: auth.companyId, ...parsed.data } });
    await writeAuditLog({ actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "COVERAGE.CREATED", entityType: "CoverageArea", entityId: saved.id, summary: `Coverage area ${saved.label} created`, request }, tx);
    return saved;
  });
  return NextResponse.json({ ok: true, area }, { status: 201 });
}
