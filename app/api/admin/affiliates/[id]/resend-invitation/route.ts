import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { recordIdSchema } from "@/lib/auth/validation";
import { applicationOrigin } from "@/lib/config";
import { renewAffiliateInvitation } from "@/lib/affiliates/invitations";
import { sendAffiliateInvitationEmail } from "@/lib/email";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsedId = recordIdSchema.safeParse((await params).id);
  if (!parsedId.success) return NextResponse.json({ error: "Invalid affiliate account." }, { status: 400 });
  const affiliate = await prisma.affiliate.findUnique({ where: { id: parsedId.data }, include: { user: true } });
  if (!affiliate) return NextResponse.json({ error: "Affiliate account not found." }, { status: 404 });
  try {
    const invitation = await renewAffiliateInvitation(affiliate.user, affiliate.userId, applicationOrigin(request.url));
    const delivery = await sendAffiliateInvitationEmail(
      affiliate.user.email,
      { firstName: affiliate.user.firstName, invitationUrl: invitation.invitationUrl },
      invitation.idempotencyKey,
    );
    await prisma.$transaction(async (tx) => {
      await tx.affiliateAuditLog.create({ data: {
        affiliateId: affiliate.id,
        actorUserId: auth.session.userId,
        action: "ADMIN.AFFILIATE_INVITATION_RESENT",
        entityType: "Affiliate",
        entityId: affiliate.id,
        summary: "Affiliate invitation resent and accepted by the email provider",
        metadata: { provider: "resend", providerEmailId: delivery.providerEmailId },
      } });
      await writeAuditLog({
        actorUserId: auth.session.userId,
        action: "ADMIN.AFFILIATE_INVITATION_RESENT",
        entityType: "Affiliate",
        entityId: affiliate.id,
        summary: `Affiliate invitation resent for ${affiliate.displayName}`,
        request,
      }, tx);
    });
    return NextResponse.json({ ok: true, delivery: "accepted" });
  } catch {
    return NextResponse.json({ error: "The invitation email could not be sent. Check the Resend sender settings and try again." }, { status: 502 });
  }
}
