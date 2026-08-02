import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import {
  CompanyProfileForm,
  LogoUpload,
} from "@/components/dashboard/management-forms";

export const dynamic = "force-dynamic";
export default async function CompanyPage() {
  const { session, companyId } = await requireSupplierPage();
  const company = await prisma.supplierCompany.findUniqueOrThrow({
    where: { id: companyId },
    include: { categories: true },
  });
  const categories = await prisma.productCategory.findMany({
    where: { active: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  const safeCompany = {
    legalName: company.legalName,
    tradingName: company.tradingName,
    companyNumber: company.companyNumber,
    vatNumber: company.vatNumber,
    websiteUrl: company.websiteUrl,
    summary: company.summary,
    contactEmail: company.contactEmail,
    contactPhone: company.contactPhone,
    addressLine1: company.addressLine1,
    addressLine2: company.addressLine2,
    city: company.city,
    county: company.county,
    postcode: company.postcode,
    businessHours: company.businessHours,
    status: company.status,
  };
  return (
    <PortalPage
      {...identity(session, company)}
      eyebrow="Supplier workspace"
      title="Company profile"
      description="Keep your matching information, contact details and working hours accurate."
    >
      <div className="management-form">
        <LogoUpload hasLogo={Boolean(company.logoUrl)} />
        <CompanyProfileForm
          company={safeCompany}
          categories={categories.map(({ id, name, description }) => ({
            id,
            name,
            description,
          }))}
          selectedCategoryIds={company.categories.map(
            (item) => item.productCategoryId,
          )}
        />
      </div>
    </PortalPage>
  );
}
