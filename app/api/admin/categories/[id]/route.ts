import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { writeAuditLog } from "@/lib/audit";
import { industryLaunchBlocker } from "@/lib/categories/industry-registry";
const schema=z.object({active:z.boolean()});
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
  if (category.slug === "fire-doors" && parsed.data.active) {
    return NextResponse.json({ error: "Fire doors remain locked until certification and product-data controls are implemented" }, { status: 409 });
  }
  const isGroup = category.parentId === null;
  if (isGroup && parsed.data.active) {
    const blocker = industryLaunchBlocker(category.slug, category.children.filter((product) => product.active).length);
    if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });
  }
  await prisma.$transaction(async (tx) => {
    await tx.productCategory.update({ where: { id }, data: { active: parsed.data.active } });
    await writeAuditLog({
      actorUserId: auth.session.userId,
      action: isGroup
        ? parsed.data.active ? "ADMIN.CATEGORY_GROUP_LAUNCHED" : "ADMIN.CATEGORY_GROUP_TAKEN_OFFLINE"
        : "ADMIN.CATEGORY_STATUS_UPDATED",
      entityType: "ProductCategory",
      entityId: id,
      summary: isGroup
        ? `Product group ${category.name} ${parsed.data.active ? "launched publicly" : "taken offline"}`
        : `Product category ${category.name} ${parsed.data.active ? "enabled" : "disabled"}`,
      request,
    }, tx);
  });
  return NextResponse.json({ ok: true });
}
