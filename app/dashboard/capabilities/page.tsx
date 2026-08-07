import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import { CapabilityManager } from "@/components/dashboard/capability-manager";
import { launchedSupplierCategoryWhere } from "@/lib/categories/catalogue";

export const dynamic = "force-dynamic";

export default async function CapabilitiesPage() {
  const { session, companyId } = await requireSupplierPage();
  const company = await prisma.supplierCompany.findUniqueOrThrow({ where: { id: companyId } });
  const selections = await prisma.supplierProductCategory.findMany({
    where: { supplierCompanyId: companyId },
    select: { productCategoryId: true },
  });
  const selectedCategoryIds = selections.map(({ productCategoryId }) => productCategoryId);
  const categories = selectedCategoryIds.length
    ? await prisma.productCategory.findMany({
        where: {
          ...launchedSupplierCategoryWhere(),
          id: { in: selectedCategoryIds },
        },
        include: { parent: { select: { name: true, slug: true } } },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      })
    : [];
  const capabilities = selectedCategoryIds.length
    ? await prisma.supplierCapability.findMany({
        where: {
          supplierCompanyId: companyId,
          productCategoryId: { in: selectedCategoryIds },
        },
      })
    : [];
  const byCategory = new Map(capabilities.map((item) => [item.productCategoryId, item]));
  return <PortalPage {...identity(session, company)} eyebrow="Live supplier network" title="Capabilities & capacity" description="Tell Bridge AI exactly what you can supply and your current lead times so only suitable enquiries reach your team.">
    <CapabilityManager capabilities={categories.map((productCategory) => {
      const saved = byCategory.get(productCategory.id);
      return {
        productCategoryId: productCategory.id,
        categoryName: productCategory.name,
        categorySlug: productCategory.slug,
        industryName: productCategory.parent?.name ?? "Other products",
        industrySlug: productCategory.parent?.slug ?? productCategory.slug,
        manufacturerNames: saved?.manufacturerNames ?? [],
        systemNames: saved?.systemNames ?? [],
        colourNames: saved?.colourNames ?? [],
        finishNames: saved?.finishNames ?? [],
        minimumOrderValue: saved?.minimumOrderValue === null || saved?.minimumOrderValue === undefined ? null : Number(saved.minimumOrderValue),
        minimumOrderQuantity: saved?.minimumOrderQuantity ?? null,
        standardLeadTimeDays: saved?.standardLeadTimeDays ?? 14,
        urgentLeadTimeDays: saved?.urgentLeadTimeDays ?? null,
        currentLeadTimeDays: saved?.currentLeadTimeDays ?? null,
        supportsSupplyOnly: saved?.supportsSupplyOnly ?? true,
        supportsDelivery: saved?.supportsDelivery ?? true,
        supportsInstallation: saved?.supportsInstallation ?? false,
        supportsService: saved?.supportsService ?? false,
        collectionAvailable: saved?.collectionAvailable ?? false,
        deliveryDays: saved?.deliveryDays ?? [1, 2, 3, 4, 5],
        capacityStatus: saved?.capacityStatus ?? "AVAILABLE",
        restrictedProducts: saved?.restrictedProducts ?? [],
        deliveryDelayDays: saved?.deliveryDelayDays ?? null,
        shortageNote: saved?.shortageNote ?? null,
        shortageUntil: saved?.shortageUntil?.toISOString() ?? null,
        active: saved?.active ?? true,
        lastConfirmedAt: saved?.lastConfirmedAt?.toISOString() ?? null,
      };
    })}/>
  </PortalPage>;
}
