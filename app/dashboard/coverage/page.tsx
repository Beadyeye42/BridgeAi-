import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import { CoverageManager } from "@/components/dashboard/management-forms";

export const dynamic = "force-dynamic";
export default async function CoveragePage(){const {session,companyId}=await requireSupplierPage();const company=await prisma.supplierCompany.findUniqueOrThrow({where:{id:companyId},include:{coverageAreas:{where:{active:true},orderBy:{createdAt:"asc"}}}});return <PortalPage {...identity(session,company)} eyebrow="Opportunity matching" title="Coverage areas" description="Define postcode prefixes or a delivery radius used when matching new enquiries."><CoverageManager areas={company.coverageAreas.map((a)=>({id:a.id,type:a.type,label:a.label,postcodePrefix:a.postcodePrefix,centrePostcode:a.centrePostcode,radiusMiles:a.radiusMiles}))}/></PortalPage>}
