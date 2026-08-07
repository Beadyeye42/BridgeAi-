import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/api";
import { productCategorySchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { categorySlugFromName } from "@/lib/categories/slug";
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsed = productCategorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const parentId = parsed.data.parentId ?? null;
  const slug = parsed.data.slug ?? categorySlugFromName(parsed.data.name);
  if (slug.length < 2) return NextResponse.json({ error: "Enter a longer industry or product name" }, { status: 400 });
  if (parentId) {
    const parent = await prisma.productCategory.findUnique({ where: { id: parentId }, select: { parentId: true, adminVisible: true } });
    if (!parent || parent.parentId || !parent.adminVisible) return NextResponse.json({ error: "Choose a visible top-level industry" }, { status: 400 });
  }
  try {
    const category = await prisma.$transaction(async (tx) => {
      const saved = await tx.productCategory.create({
        data: { ...parsed.data, slug, parentId, active: false },
      });
      await writeAuditLog({
        actorUserId: auth.session.userId,
        action: parentId ? "ADMIN.CATEGORY_CREATED" : "ADMIN.CATEGORY_GROUP_STAGED",
        entityType: "ProductCategory",
        entityId: saved.id,
        summary: parentId ? `Product category ${saved.name} created` : `Product group ${saved.name} staged offline`,
        request,
      }, tx);
      return saved;
    });
    return NextResponse.json({ ok: true, category }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "A category with that name or slug already exists" }, { status: 409 });
  }
}
