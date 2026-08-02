import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { writeAuditLog } from "@/lib/audit";

const roleSchema = z.object({ role: z.enum(["MANAGER", "MEMBER"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSupplierApi(); if ("error" in auth) return auth.error;
  const actor = auth.session.user.memberships.find((member) => member.supplierCompanyId === auth.companyId);
  if (actor?.role !== "OWNER") return NextResponse.json({ error: "Only the company owner can change team access" }, { status: 403 });
  const { id } = await params;
  const target = await prisma.supplierTeamMembership.findFirst({ where: { id, supplierCompanyId: auth.companyId }, include: { user: true } });
  if (!target) return NextResponse.json({ error: "Team member not found" }, { status: 404 });
  if (target.role === "OWNER" || target.userId === auth.session.userId) return NextResponse.json({ error: "The owner membership cannot be changed here" }, { status: 409 });
  const parsed = roleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid team role" }, { status: 400 });
  await prisma.$transaction(async (tx) => {
    await tx.supplierTeamMembership.update({ where: { id }, data: { role: parsed.data.role } });
    await writeAuditLog({ actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "TEAM.ROLE_UPDATED", entityType: "SupplierTeamMembership", entityId: id, summary: `Team role for ${target.user.email} changed to ${parsed.data.role}`, request }, tx);
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSupplierApi(); if ("error" in auth) return auth.error;
  const actor = auth.session.user.memberships.find((member) => member.supplierCompanyId === auth.companyId);
  if (actor?.role !== "OWNER") return NextResponse.json({ error: "Only the company owner can change team access" }, { status: 403 });
  const { id } = await params;
  const target = await prisma.supplierTeamMembership.findFirst({ where: { id, supplierCompanyId: auth.companyId }, include: { user: true } });
  if (!target) return NextResponse.json({ error: "Team member not found" }, { status: 404 });
  if (target.role === "OWNER" || target.userId === auth.session.userId) return NextResponse.json({ error: "The owner membership cannot be changed here" }, { status: 409 });
  await prisma.$transaction(async (tx) => {
    await tx.supplierTeamMembership.update({ where: { id }, data: { status: "REMOVED", isPrimary: false } });
    await writeAuditLog({ actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "TEAM.MEMBER_REMOVED", entityType: "SupplierTeamMembership", entityId: id, summary: `${target.user.email} removed from supplier team`, request }, tx);
  });
  return NextResponse.json({ ok: true });
}
