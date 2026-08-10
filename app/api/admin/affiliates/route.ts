import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { affiliateCreateSchema, validationError } from "@/lib/auth/validation";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { applicationOrigin } from "@/lib/config";
import { writeAuditLog } from "@/lib/audit";
import { createAffiliateInvitation } from "@/lib/affiliates/invitations";
import { sendAffiliateInvitationEmail } from "@/lib/email";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsed = affiliateCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const existing = await prisma.affiliate.findFirst({ where: { OR: [{ code: parsed.data.code }, { user: { email: parsed.data.email } }] } });
  if (existing) return NextResponse.json({ error: "That affiliate email or code already exists." }, { status: 409 });
  let invitation: Awaited<ReturnType<typeof createAffiliateInvitation>>;
  try {
    invitation = await createAffiliateInvitation(parsed.data, applicationOrigin(request.url));
  } catch {
    return NextResponse.json({ error: "The secure affiliate invitation could not be created." }, { status: 502 });
  }
  try {
    const affiliate = await prisma.$transaction(async (tx) => {
      await tx.user.create({ data: {
        id: invitation.user.id,
        email: parsed.data.email,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        status: "ACTIVE",
        emailVerifiedAt: invitation.user.email_confirmed_at ? new Date(invitation.user.email_confirmed_at) : null,
      } });
      const saved = await tx.affiliate.create({ data: {
        userId: invitation.user.id,
        displayName: parsed.data.displayName,
        code: parsed.data.code,
        status: parsed.data.activate ? "ACTIVE" : "PENDING",
        approvedAt: parsed.data.activate ? new Date() : null,
        approvedById: parsed.data.activate ? auth.session.userId : null,
      } });
      await tx.affiliateAuditLog.create({ data: {
        affiliateId: saved.id,
        actorUserId: auth.session.userId,
        action: "ADMIN.AFFILIATE_CREATED",
        entityType: "Affiliate",
        entityId: saved.id,
        summary: `Affiliate account created as ${saved.status}`,
        metadata: { code: saved.code, email: parsed.data.email },
      } });
      await writeAuditLog({ actorUserId: auth.session.userId, action: "ADMIN.AFFILIATE_CREATED", entityType: "Affiliate", entityId: saved.id, summary: `Affiliate ${saved.displayName} created`, request }, tx);
      return saved;
    });
    try {
      const delivery = await sendAffiliateInvitationEmail(
        parsed.data.email,
        { firstName: parsed.data.firstName, invitationUrl: invitation.invitationUrl },
        invitation.idempotencyKey,
      );
      await prisma.affiliateAuditLog.create({ data: {
        affiliateId: affiliate.id,
        actorUserId: auth.session.userId,
        action: "ADMIN.AFFILIATE_INVITATION_SENT",
        entityType: "Affiliate",
        entityId: affiliate.id,
        summary: "Affiliate invitation accepted by the email provider",
        metadata: { provider: "resend", providerEmailId: delivery.providerEmailId },
      } });
      return NextResponse.json({ ok: true, affiliate, delivery: "accepted" }, { status: 201 });
    } catch {
      await prisma.$transaction([
        prisma.affiliateAuditLog.deleteMany({ where: { affiliateId: affiliate.id } }),
        prisma.auditLog.deleteMany({ where: { actorUserId: auth.session.userId, action: "ADMIN.AFFILIATE_CREATED", entityType: "Affiliate", entityId: affiliate.id } }),
        prisma.user.delete({ where: { id: invitation.user.id } }),
      ]).catch(() => undefined);
      await getSupabaseAdmin().auth.admin.deleteUser(invitation.user.id).catch(() => undefined);
      return NextResponse.json({ error: "The email provider did not accept the invitation. The affiliate was not created; check the Resend sender settings and try again." }, { status: 502 });
    }
  } catch (cause) {
    await getSupabaseAdmin().auth.admin.deleteUser(invitation.user.id).catch(() => undefined);
    const message = cause instanceof Error && cause.message.includes("maximum active affiliate") ? "The programme has reached its active affiliate limit." : "The affiliate account could not be created.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
