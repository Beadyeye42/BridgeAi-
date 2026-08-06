import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";
import { companyProfileSchema, validationError } from "@/lib/auth/validation";
import { writeAuditLog } from "@/lib/audit";
import { launchCategoryRootId } from "@/lib/categories/catalogue";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const parsed = companyProfileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationError(parsed.error) }, { status: 400 });
  const { categoryIds, ...profile } = parsed.data;
  const categoryCount = await prisma.productCategory.count({
    where: { id: { in: categoryIds }, active: true, parentId: launchCategoryRootId },
  });
  if (categoryCount !== categoryIds.length) return NextResponse.json({ error: "One or more product categories are unavailable" }, { status: 400 });
  const company = await prisma.$transaction(async (tx) => {
    const saved = await tx.supplierCompany.update({ where: { id: auth.companyId }, data: profile });
    await tx.supplierProductCategory.deleteMany({ where: { supplierCompanyId: auth.companyId, productCategoryId: { notIn: categoryIds } } });
    await tx.supplierProductCategory.createMany({ data: categoryIds.map((productCategoryId) => ({ supplierCompanyId: auth.companyId, productCategoryId })), skipDuplicates: true });
    await writeAuditLog({ actorUserId: auth.session.userId, supplierCompanyId: auth.companyId, action: "SUPPLIER.PROFILE_UPDATED", entityType: "SupplierCompany", entityId: auth.companyId, summary: "Supplier company profile updated", request }, tx);
    return saved;
  });
  return NextResponse.json({ ok: true, company: { id: company.id, updatedAt: company.updatedAt } });
}
