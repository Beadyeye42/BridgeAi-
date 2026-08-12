import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import {
  CompanyProfileForm,
  LogoUpload,
} from "@/components/dashboard/management-forms";
import { OnboardingReadiness } from "@/components/dashboard/onboarding-readiness";
import { supplierApprovalReadiness } from "@/lib/suppliers/onboarding";
import { launchedSupplierCategoryWhere } from "@/lib/categories/catalogue";

export const dynamic = "force-dynamic";
export default async function CompanyPage() {
  const { session, companyId } = await requireSupplierPage();
  const company = await prisma.supplierCompany.findUniqueOrThrow({
    where: { id: companyId },
    include: {
      categories: true,
      coverageAreas: true,
      memberships: true,
    },
  });
  const categories = await prisma.productCategory.findMany({
    where: launchedSupplierCategoryWhere(),
    include: { parent: { select: { name: true } } },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  const safeCompany = {
    legalName: company.legalName,
    companyNumber: company.companyNumber,
    directorName: company.directorName,
    contactEmail: company.contactEmail,
    contactPhone: company.contactPhone,
    addressLine1: company.addressLine1,
    addressLine2: company.addressLine2,
    city: company.city,
    county: company.county,
    postcode: company.postcode,
    status: company.status,
  };
  return (
    <PortalPage
      {...identity(session, company)}
      eyebrow="Supplier workspace"
      title="Company profile"
      description="Add the company identity, address and contact details Bridge-iT needs to review your account."
    >
      <div className="management-form">
        <OnboardingReadiness readiness={supplierApprovalReadiness(company)} status={company.status} />
        <LogoUpload hasLogo={Boolean(company.logoUrl)} />
        <CompanyProfileForm
          company={safeCompany}
          categories={categories.map(({ id, name, description, parent }) => ({
            id,
            name,
            description,
            groupName: parent?.name ?? "Products",
          }))}
          selectedCategoryIds={company.categories.map(
            (item) => item.productCategoryId,
          )}
        />
      </div>
    </PortalPage>
  );
}
