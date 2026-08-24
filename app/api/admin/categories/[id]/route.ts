import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { writeAuditLog } from "@/lib/audit";
import { industryLaunchBlocker } from "@/lib/categories/industry-registry";
import { buyerExperienceSchema } from "@/lib/buyer/industry-experience";
const schema = z.object({
  active: z.boolean().optional(),
  servesConsumer: z.boolean().optional(),
  servesTrade: z.boolean().optional(),
  servesBusiness: z.boolean().optional(),
  hyperlocalEnabled: z.boolean().optional(),
  acknowledgementDeadlineHours: z.number().int().min(1).max(168).nullable().optional(),
  quotationDeadlineHours: z.number().int().min(1).max(336).nullable().optional(),
  buyerExperienceConfig: buyerExperienceSchema.optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), "No changes supplied");
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid category status" }, { status: 400 });
  const { id } = await params;
  const category = await prisma.productCategory.findUnique({
    where: { id },
    include: { children: { select: { active: true } } },
  });
  if (!category || (category.parentId === null && !category.adminVisible)) {
    return NextResponse.json({ error: "Industry not found" }, { status: 404 });
  }
  if (category.slug === "fire-doors" && parsed.data.active === true) {
    return NextResponse.json({ error: "Fire doors remain locked until certification and product-data controls are implemented" }, { status: 409 });
  }
  const isGroup = category.parentId === null;
  if (isGroup && parsed.data.active === true) {
    const blocker = industryLaunchBlocker(category.slug, category.children.filter((product) => product.active).length);
    if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });
  }
  const audience = {
    servesConsumer: parsed.data.servesConsumer ?? category.servesConsumer,
    servesTrade: parsed.data.servesTrade ?? category.servesTrade,
    servesBusiness: parsed.data.servesBusiness ?? category.servesBusiness,
  };
  const audienceChanged = parsed.data.servesConsumer !== undefined || parsed.data.servesTrade !== undefined || parsed.data.servesBusiness !== undefined;
  const hyperlocalChanged = parsed.data.hyperlocalEnabled !== undefined;
  const deadlineChanged = parsed.data.acknowledgementDeadlineHours !== undefined || parsed.data.quotationDeadlineHours !== undefined;
  const buyerExperienceChanged = parsed.data.buyerExperienceConfig !== undefined;
  if (audienceChanged && !isGroup) return NextResponse.json({ error: "Buyer audiences are managed at industry level" }, { status: 400 });
  if (hyperlocalChanged && !isGroup) return NextResponse.json({ error: "Hyperlocal availability is managed at industry level" }, { status: 400 });
  if (deadlineChanged && !isGroup) return NextResponse.json({ error: "Response deadlines are managed at industry level" }, { status: 400 });
  if (buyerExperienceChanged && !isGroup) return NextResponse.json({ error: "Buyer Hub configuration is managed at industry level" }, { status: 400 });
  if (!audience.servesConsumer && !audience.servesTrade && !audience.servesBusiness) return NextResponse.json({ error: "Select at least one buyer audience" }, { status: 400 });
  await prisma.$transaction(async (tx) => {
    await tx.productCategory.update({ where: { id }, data: { ...parsed.data } });
    await writeAuditLog({
      actorUserId: auth.session.userId,
      action: buyerExperienceChanged ? "ADMIN.INDUSTRY_BUYER_EXPERIENCE_UPDATED" : deadlineChanged ? "ADMIN.INDUSTRY_RESPONSE_DEADLINES_UPDATED" : hyperlocalChanged ? "ADMIN.INDUSTRY_HYPERLOCAL_UPDATED" : audienceChanged ? "ADMIN.INDUSTRY_AUDIENCE_UPDATED" : isGroup
        ? parsed.data.active ? "ADMIN.CATEGORY_GROUP_LAUNCHED" : "ADMIN.CATEGORY_GROUP_TAKEN_OFFLINE"
        : "ADMIN.CATEGORY_STATUS_UPDATED",
      entityType: "ProductCategory",
      entityId: id,
      summary: buyerExperienceChanged
        ? `Buyer Hub labels, fields and lifecycle updated for ${category.name}`
        : deadlineChanged
        ? `Supplier response deadlines updated for ${category.name}`
        : hyperlocalChanged
        ? `Hyperlocal membership ${parsed.data.hyperlocalEnabled ? "enabled" : "disabled"} for ${category.name}`
        : audienceChanged
        ? `Buyer audiences updated for ${category.name}`
        : isGroup
        ? `Product group ${category.name} ${parsed.data.active ? "launched publicly" : "taken offline"}`
        : `Product category ${category.name} ${parsed.data.active ? "enabled" : "disabled"}`,
      metadata: buyerExperienceChanged
        ? { version: parsed.data.buyerExperienceConfig?.version, stageKeys: parsed.data.buyerExperienceConfig?.stages.map((stage) => stage.key), detailFieldKeys: parsed.data.buyerExperienceConfig?.detailFields.map((field) => field.key) }
        : deadlineChanged
        ? { before: { acknowledgementDeadlineHours: category.acknowledgementDeadlineHours, quotationDeadlineHours: category.quotationDeadlineHours }, after: { acknowledgementDeadlineHours: parsed.data.acknowledgementDeadlineHours, quotationDeadlineHours: parsed.data.quotationDeadlineHours } }
        : hyperlocalChanged
        ? { before: { hyperlocalEnabled: category.hyperlocalEnabled }, after: { hyperlocalEnabled: parsed.data.hyperlocalEnabled } }
        : audienceChanged ? { before: { servesConsumer: category.servesConsumer, servesTrade: category.servesTrade, servesBusiness: category.servesBusiness }, after: audience } : undefined,
      request,
    }, tx);
  });
  return NextResponse.json({ ok: true });
}
