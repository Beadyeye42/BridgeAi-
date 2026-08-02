import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { teamInviteSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { sendTeamInvitationEmail } from "@/lib/email";

export async function POST(request: Request) {
  const auth = await requireSupplierApi(); if ("error" in auth) return auth.error;
  const actorMembership = auth.session.user.memberships.find((item) => item.supplierCompanyId === auth.companyId);
  if (!actorMembership || !["OWNER", "MANAGER"].includes(actorMembership.role)) return NextResponse.json({ error: "Only owners and managers can invite team members" }, { status: 403 });
  const parsed = teamInviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const existingMember = await prisma.supplierTeamMembership.findFirst({ where: { supplierCompanyId: auth.companyId, user: { email: parsed.data.email } } });
  if (existingMember) return NextResponse.json({ error: "This user is already a team member" }, { status: 409 });
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  const invitation = await prisma.$transaction(async (tx) => {
    const saved = await tx.supplierInvite.upsert({ where: { supplierCompanyId_email: { supplierCompanyId: auth.companyId, email: parsed.data.email } }, update: { role: parsed.data.role, tokenHash, invitedById: auth.session.userId, expiresAt, acceptedAt: null }, create: { supplierCompanyId: auth.companyId, email: parsed.data.email, role: parsed.data.role, tokenHash, invitedById: auth.session.userId, expiresAt } });
    await writeAuditLog({ actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "TEAM.INVITED", entityType: "SupplierInvite", entityId: saved.id, summary: `Team invitation sent to ${parsed.data.email}`, request }, tx);
    return saved;
  });
  const origin = process.env.APP_URL ?? new URL(request.url).origin;
  const delivery = await sendTeamInvitationEmail(parsed.data.email, `${origin}/register?invite=${encodeURIComponent(token)}`);
  return NextResponse.json({ ok: true, invitationId: invitation.id, delivered: delivery.delivered }, { status: 201 });
}
