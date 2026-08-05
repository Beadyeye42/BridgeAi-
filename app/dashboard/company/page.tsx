import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import {
  CompanyProfileForm,
  LogoUpload,
} from "@/components/dashboard/management-forms";
import { AccreditationManager } from "@/components/dashboard/accreditation-manager";
import { OnboardingReadiness } from "@/components/dashboard/onboarding-readiness";
import { supplierOnboardingReadiness } from "@/lib/suppliers/onboarding";

export const dynamic = "force-dynamic";
export default async function CompanyPage() {
  const { session, companyId } = await requireSupplierPage();
  const company = await prisma.supplierCompany.findUniqueOrThrow({
    where: { id: companyId },
    include: {
      categories: true,
      coverageAreas: true,
      memberships: true,
      accreditations: {
        include: { attachment: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  const categories = await prisma.productCategory.findMany({
    where: { active: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  const membership = session.user.memberships.find((item) => item.supplierCompanyId === companyId);
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
        <OnboardingReadiness readiness={supplierOnboardingReadiness(company)} status={company.status} />
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
        <AccreditationManager
          canManage={Boolean(membership && ["OWNER", "MANAGER"].includes(membership.role))}
          accreditations={company.accreditations.map((item) => ({
            id: item.id,
            type: item.type,
            displayName: item.displayName,
            referenceNumber: item.referenceNumber,
            issuingBody: item.issuingBody,
            issuedAt: item.issuedAt?.toISOString() ?? null,
            expiresAt: item.expiresAt?.toISOString() ?? null,
            status: item.status,
            reviewNote: item.reviewNote,
            attachment: {
              id: item.attachment.id,
              fileName: item.attachment.fileName,
              scanStatus: item.attachment.scanStatus,
            },
          }))}
        />
      </div>
    </PortalPage>
  );
}
