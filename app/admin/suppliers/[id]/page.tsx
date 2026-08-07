import { Download, FileBadge2 } from "lucide-react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { AdminSupplierEdit, ComplimentaryMembershipControl, SupplierGeographyOverride, SupplierStatusControl } from "@/components/admin/admin-actions";
import { AccreditationReviewActions } from "@/components/admin/accreditation-actions";
import { OnboardingReadiness } from "@/components/dashboard/onboarding-readiness";
import { supplierApprovalReadiness } from "@/lib/suppliers/onboarding";

export default async function SupplierInspectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const supplier = await prisma.supplierCompany.findUnique({
    where: { id },
    include: {
      memberships: { include: { user: true } },
      coverageAreas: true,
      categories: { include: { productCategory: true } },
      subscription: { include: { membershipPlan: true } },
      assignments: { where: { respondedAt: { not: null } }, select: { assignedAt: true, respondedAt: true } },
      capabilities: { where: { active: true }, include: { productCategory: { select: { name: true } } }, orderBy: { capacityLastConfirmedAt: "asc" } },
      accreditations: {
        include: { attachment: true, createdBy: true, reviewedBy: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  const membershipPlans = await prisma.membershipPlan.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { displayOrder: "asc" } });
  const matchingConfiguration = await prisma.matchingConfiguration.findUniqueOrThrow({ where: { id: "default" } });
  if (!supplier) notFound();
  const onboarding = supplierApprovalReadiness(supplier);
  const averageResponse = supplier.assignments.length
    ? supplier.assignments.reduce((total, assignment) => total + ((assignment.respondedAt?.getTime() ?? assignment.assignedAt.getTime()) - assignment.assignedAt.getTime()), 0) / supplier.assignments.length
    : null;
  const coverageDefinition = (area: typeof supplier.coverageAreas[number]) => area.type === "POSTCODE"
    ? `Postcode area ${area.postcodePrefix}`
    : area.type === "NATIONWIDE" ? "All UK postcodes" : `${area.radiusMiles} mile radius from ${area.centrePostcode}`;
  // This is an async server-rendered operational status page; staleness must be
  // evaluated against request time rather than a cached build-time value.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const staleCapabilities = supplier.capabilities.filter((capability) => now - capability.capacityLastConfirmedAt.getTime() > matchingConfiguration.capacityStaleDays * 86_400_000 || now - capability.leadTimeLastConfirmedAt.getTime() > matchingConfiguration.leadTimeStaleDays * 86_400_000);

  return <>
    <AdminHeading eyebrow={supplier.status} title={supplier.tradingName ?? supplier.legalName} description={`${supplier.contactEmail} · ${supplier.contactPhone}`} actions={<SupplierStatusControl id={id} status={supplier.status} approvalReady={onboarding.ready} approvalBlockers={onboarding.blockers} />} />
    <div className="spaced-section"><OnboardingReadiness readiness={onboarding} status={supplier.status} admin /></div>
    <div className="management-grid">
      <section className="panel form-section">
        <div className="section-heading"><div><p className="eyebrow">Company record</p><h2>Profile</h2></div></div>
        <dl className="detail-list">
          <div><dt>Legal name</dt><dd>{supplier.legalName}</dd></div>
          <div><dt>Company number</dt><dd>{supplier.companyNumber ?? "—"}</dd></div>
          <div><dt>Director</dt><dd>{supplier.directorName ?? "—"}</dd></div>
          <div><dt>Address</dt><dd>{[supplier.addressLine1, supplier.city, supplier.county, supplier.postcode].filter(Boolean).join(", ") || "—"}</dd></div>
          <div><dt>Average response</dt><dd>{averageResponse ? `${Math.round(averageResponse / 3600000)} hours` : "No completed responses"}</dd></div>
          <div><dt>Subscription</dt><dd>{supplier.subscription ? `${supplier.subscription.accessSource === "COMPLIMENTARY" ? "Complimentary" : supplier.subscription.planCode} · ${supplier.subscription.status}` : "None"}</dd></div>
        </dl>
        <p className="body-copy">{supplier.summary}</p>
      </section>
      <section className="panel form-section">
        <div className="section-heading"><div><p className="eyebrow">Matching configuration</p><h2>Categories & coverage</h2></div></div>
        <div className="tag-list">{supplier.categories.map((category) => <span className="status-pill" key={category.productCategoryId}>{category.productCategory.name}</span>)}</div>
        <div className="entity-list">{supplier.coverageAreas.map((area) => <article className="entity-row" key={area.id}><div><b>{area.label}</b><small>{coverageDefinition(area)} · {area.active ? "active" : "disabled"}</small></div></article>)}</div>
        <div className="section-subheading">Team</div>
        <div className="entity-list">{supplier.memberships.map((membership) => <article className="entity-row" key={membership.id}><div><b>{membership.user.firstName} {membership.user.lastName}</b><small>{membership.user.email}</small></div><span className="status-pill">{membership.role}</span></article>)}</div>
      </section>
    </div>
    <ComplimentaryMembershipControl id={id} approved={supplier.status === "APPROVED"} plans={membershipPlans} subscription={supplier.subscription ? { accessSource: supplier.subscription.accessSource, status: supplier.subscription.status, currentPeriodEnd: supplier.subscription.currentPeriodEnd?.toISOString() ?? null, complimentaryReason: supplier.subscription.complimentaryReason } : null} />
    <SupplierGeographyOverride supplier={{ id: supplier.id, membershipTierOverride: supplier.membershipTierOverride, maximumActiveOpportunitiesOverride: supplier.maximumActiveOpportunitiesOverride, maximumServiceRadiusOverride: supplier.maximumServiceRadiusOverride, maximumDeliveryRadiusOverride: supplier.maximumDeliveryRadiusOverride, planName: supplier.subscription?.membershipPlan?.name ?? null }}/>
    <section className="panel form-section spaced-section"><div className="section-heading"><div><p className="eyebrow">Live matching data</p><h2>Capacity freshness</h2></div><span className={`status-pill ${staleCapabilities.length ? "pending" : "approved"}`}>{staleCapabilities.length ? `${staleCapabilities.length} STALE` : "CURRENT"}</span></div>{staleCapabilities.length ? <div className="entity-list">{staleCapabilities.map((capability)=><article className="entity-row" key={capability.id}><div><b>{capability.productCategory.name}</b><small>Capacity confirmed {capability.capacityLastConfirmedAt.toLocaleDateString("en-GB")} · lead time confirmed {capability.leadTimeLastConfirmedAt.toLocaleDateString("en-GB")}</small></div></article>)}</div> : <p className="body-copy">All active capability records are inside the configured freshness periods.</p>}</section>
    <section className="panel form-section spaced-section">
      <div className="section-heading"><div><p className="eyebrow">Optional documents</p><h2>Accreditations & insurance</h2></div><FileBadge2 size={20} /></div>
      <div className="entity-list">
        {supplier.accreditations.length === 0 && <div className="empty-state">This supplier has not uploaded any accreditation evidence.</div>}
        {supplier.accreditations.map((item) => <article className="entity-row accreditation-row" key={item.id}>
          <span className="large-icon"><FileBadge2 size={20} /></span>
          <div>
            <b>{item.displayName}</b>
            <small>{item.type.replaceAll("_", " ")} · {item.attachment.fileName}</small>
            <small>Uploaded by {item.createdBy.firstName} {item.createdBy.lastName} · scan {item.attachment.scanStatus.toLowerCase()}{item.expiresAt ? ` · expires ${item.expiresAt.toLocaleDateString("en-GB")}` : ""}</small>
            {item.reviewNote && <small>Review note: {item.reviewNote}</small>}
          </div>
          <span className={`status-pill ${item.status.toLowerCase()}`}>{item.status}</span>
          <div className="inline-actions">
            {item.attachment.scanStatus === "CLEAN" && <a className="button button-outline" href={`/api/attachments/${item.attachment.id}/download`}><Download size={14} />Review file</a>}
            {item.status === "PENDING" && <AccreditationReviewActions id={item.id} scanStatus={item.attachment.scanStatus} />}
          </div>
        </article>)}
      </div>
    </section>
    <div className="spaced-section"><AdminSupplierEdit supplier={{ id: supplier.id, legalName: supplier.legalName, companyNumber: supplier.companyNumber, directorName: supplier.directorName, contactEmail: supplier.contactEmail, contactPhone: supplier.contactPhone, addressLine1: supplier.addressLine1, addressLine2: supplier.addressLine2, city: supplier.city, county: supplier.county, postcode: supplier.postcode }} /></div>
  </>;
}
