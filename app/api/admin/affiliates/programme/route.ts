import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { affiliateProgrammeAdminSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;

  const parsed = affiliateProgrammeAdminSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });

  try {
    const programme = await prisma.$transaction(async (tx) => {
      const [before, activeCount] = await Promise.all([
        tx.affiliateProgramme.findUnique({ where: { id: "default" } }),
        tx.affiliate.count({ where: { status: "ACTIVE" } }),
      ]);
      if (!before) throw new Error("AFFILIATE_PROGRAMME_MISSING");
      if (parsed.data.maximumActive < activeCount) {
        throw new Error(`AFFILIATE_LIMIT_BELOW_ACTIVE:${activeCount}`);
      }
      const saved = await tx.affiliateProgramme.update({ where: { id: "default" }, data: parsed.data });
      await writeAuditLog({
        actorUserId: auth.session.userId,
        action: "ADMIN.AFFILIATE_PROGRAMME_UPDATED",
        entityType: "AffiliateProgramme",
        entityId: saved.id,
        summary: "Affiliate programme commercial controls updated",
        metadata: { before, after: parsed.data },
        request,
      }, tx);
      return saved;
    });
    return NextResponse.json({ ok: true, programme });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "AFFILIATE_PROGRAMME_MISSING") {
      return NextResponse.json({ error: "Affiliate programme settings are unavailable." }, { status: 503 });
    }
    if (cause instanceof Error && cause.message.startsWith("AFFILIATE_LIMIT_BELOW_ACTIVE:")) {
      const activeCount = Number(cause.message.split(":")[1]);
      return NextResponse.json(
        { error: `The limit cannot be below the ${activeCount} currently active affiliate${activeCount === 1 ? "" : "s"}.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Affiliate programme controls could not be saved." }, { status: 500 });
  }
}
