import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import { CapabilityManager } from "@/components/dashboard/capability-manager";

export const dynamic = "force-dynamic";

export default async function CapabilitiesPage() {
  const { session, companyId } = await requireSupplierPage();
  const company = await prisma.supplierCompany.findUniqueOrThrow({
    where: { id: companyId },
    include: {
      categories: { include: { productCategory: true }, orderBy: { productCategory: { displayOrder: "asc" } } },
      capabilities: true,
    },
  });
  const byCategory = new Map(company.capabilities.map((item) => [item.productCategoryId, item]));
  return <PortalPage {...identity(session, company)} eyebrow="Live supplier network" title="Capabilities & capacity" description="Tell Bridge AI exactly what you can supply and your current lead times so only suitable enquiries reach your team.">
    <CapabilityManager capabilities={company.categories.map(({ productCategory }) => {
      const saved = byCategory.get(productCategory.id);
      return {
        productCategoryId: productCategory.id,
        categoryName: productCategory.name,
        categorySlug: productCategory.slug,
        manufacturerNames: saved?.manufacturerNames ?? [],
        systemNames: saved?.systemNames ?? [],
        colourNames: saved?.colourNames ?? [],
        finishNames: saved?.finishNames ?? [],
        minimumOrderValue: saved?.minimumOrderValue === null || saved?.minimumOrderValue === undefined ? null : Number(saved.minimumOrderValue),
        minimumOrderQuantity: saved?.minimumOrderQuantity ?? null,
        standardLeadTimeDays: saved?.standardLeadTimeDays ?? 14,
        urgentLeadTimeDays: saved?.urgentLeadTimeDays ?? null,
        collectionAvailable: saved?.collectionAvailable ?? false,
        deliveryDays: saved?.deliveryDays ?? [1, 2, 3, 4, 5],
        capacityStatus: saved?.capacityStatus ?? "AVAILABLE",
        shortageNote: saved?.shortageNote ?? null,
        shortageUntil: saved?.shortageUntil?.toISOString() ?? null,
        active: saved?.active ?? true,
        lastConfirmedAt: saved?.lastConfirmedAt.toISOString() ?? null,
      };
    })}/>
  </PortalPage>;
}
