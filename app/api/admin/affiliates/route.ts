import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { affiliateCreateSchema, validationError } from "@/lib/auth/validation";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { applicationOrigin } from "@/lib/config";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsed = affiliateCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const existing = await prisma.affiliate.findFirst({ where: { OR: [{ code: parsed.data.code }, { user: { email: parsed.data.email } }] } });
  if (existing) return NextResponse.json({ error: "That affiliate email or code already exists." }, { status: 409 });
  const { data, error } = await getSupabaseAdmin().auth.admin.inviteUserByEmail(parsed.data.email, {
    redirectTo: `${applicationOrigin(request.url)}/auth/callback?next=/affiliate`,
  });
  if (error || !data.user) return NextResponse.json({ error: error?.message ?? "Affiliate invitation could not be sent." }, { status: 502 });
  try {
    const affiliate = await prisma.$transaction(async (tx) => {
      await tx.user.create({ data: {
        id: data.user.id,
        email: parsed.data.email,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        status: "ACTIVE",
        emailVerifiedAt: data.user.email_confirmed_at ? new Date(data.user.email_confirmed_at) : null,
      } });
      const saved = await tx.affiliate.create({ data: {
        userId: data.user.id,
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
    return NextResponse.json({ ok: true, affiliate }, { status: 201 });
  } catch (cause) {
    await getSupabaseAdmin().auth.admin.deleteUser(data.user.id).catch(() => undefined);
    const message = cause instanceof Error && cause.message.includes("maximum active affiliate") ? "The programme has reached its active affiliate limit." : "The affiliate account could not be created.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
