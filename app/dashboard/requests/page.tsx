import Link from "next/link";
import { Clock3, FileText, MapPin, PackageCheck, Paperclip, UsersRound } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";

export const dynamic = "force-dynamic";
const views = ["new", "submitted", "won", "lost", "expired", "all"] as const;
type View = typeof views[number];

function viewFilter(view: View, now: Date): Prisma.SupplierAssignmentWhereInput {
  switch (view) {
    case "submitted":
      return { quotation: { status: { in: ["SUBMITTED", "SELECTED_PENDING_PAYMENT"] } } };
    case "won":
      return { quotation: { status: "ACCEPTED" } };
    case "lost":
      return { quotation: { status: "REJECTED" } };
    case "expired":
      return { OR: [{ status: "EXPIRED" }, { expiresAt: { lte: now } }, { quotation: { status: "EXPIRED" } }, { quoteRequest: { status: "EXPIRED" } }] };
    default:
      return {};
  }
}

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { session, companyId } = await requireSupplierPage();
  const company = await prisma.supplierCompany.findUniqueOrThrow({ where: { id: companyId }, include: { subscription: true } });
  const raw = (await searchParams).view;
  const view: View = views.includes(raw as View) ? raw as View : "new";
  const now = new Date();
  const subscriptionActive = company.subscription?.status === "ACTIVE"
    && (!company.subscription.currentPeriodEnd || company.subscription.currentPeriodEnd > now);

  if (view === "new") {
    const opportunities = await prisma.supplierOpportunity.findMany({
      where: { status: { in: ["OPEN", "MATCHING", "QUOTED"] }, responseDueAt: { gt: now } },
      include: { category: true },
      orderBy: { responseDueAt: "asc" },
      take: 100,
    });
    const assignments = opportunities.length ? await prisma.supplierAssignment.findMany({
      where: { supplierCompanyId: companyId, quoteRequestId: { in: opportunities.map((item) => item.quoteRequestId) } },
      include: { quotation: true },
    }) : [];
    const ownAssignments = new Map(assignments.map((assignment) => [assignment.quoteRequestId, assignment]));

    return <PortalPage {...identity(session, company)} eyebrow="Supplier marketplace" title="Quote opportunities" description="Browse open jobs safely. Approval and a £5 monthly membership are only needed when you want to claim a place and quote.">
      <nav className="filter-tabs">{views.map((item) => <Link className={item === view ? "active" : ""} href={`/dashboard/requests?view=${item}`} key={item}>{item}</Link>)}</nav>
      {company.status !== "APPROVED" && <div className="privacy-note opportunity-notice"><PackageCheck size={17}/><div><b>You can browse while approval is pending</b><p>Safe lead summaries are visible now. Bridge AI approval is required before your company can claim a place or view the full quote pack.</p></div></div>}
      {company.status === "APPROVED" && !subscriptionActive && <div className="privacy-note opportunity-notice"><PackageCheck size={17}/><div><b>Browsing is free</b><p>You can inspect safe job summaries now. Subscribe only when you are ready to reserve a place and submit a quotation.</p></div></div>}
      <section className="panel request-browser">
        {opportunities.length ? opportunities.map((opportunity) => {
          const assignment = ownAssignments.get(opportunity.quoteRequestId);
          const available = Math.max(0, opportunity.distributionLimit - opportunity.claimedSlots);
          const displayStatus = assignment?.quotation?.status ?? assignment?.status ?? (available ? (subscriptionActive ? "AVAILABLE" : "MEMBERSHIP") : "FULL");
          return <Link href={`/dashboard/requests/${opportunity.reference}`} className="request-browser-row" key={opportunity.quoteRequestId}>
            <span className="status-dot" />
            <div className="request-browser-main"><span className="request-ref">{opportunity.reference}</span><b>{opportunity.title}</b><small>{opportunity.category.name}</small></div>
            <div className="request-browser-meta"><span><MapPin size={14}/>{opportunity.deliveryArea} area</span><span><FileText size={14}/>{opportunity.itemCount} items</span><span><Paperclip size={14}/>{opportunity.attachmentCount}</span><span><UsersRound size={14}/>{available} of {opportunity.distributionLimit} places</span><span><Clock3 size={14}/>{opportunity.responseDueAt.toLocaleString("en-GB")}</span></div>
            <span className={`status-pill ${displayStatus.toLowerCase()}`}>{displayStatus === "MEMBERSHIP" ? "Membership required" : displayStatus}</span>
          </Link>;
        }) : <div className="empty-state large"><FileText size={28}/><b>No open opportunities</b><p>New customer requests will appear here as soon as they are published.</p></div>}
      </section>
    </PortalPage>;
  }

  const assignments = await prisma.supplierAssignment.findMany({
    where: { supplierCompanyId: companyId, ...viewFilter(view, now) },
    include: { quoteRequest: { include: { category: true, attachments: { select: { id: true } } } }, quotation: true },
    orderBy: { assignedAt: "desc" },
    take: 100,
  });

  return <PortalPage {...identity(session, company)} eyebrow="Your company quotation history" title="Quote requests" description="Review submitted, won, lost and expired quotations for this supplier company.">
    <nav className="filter-tabs">{views.map((item) => <Link className={item === view ? "active" : ""} href={`/dashboard/requests?view=${item}`} key={item}>{item}</Link>)}</nav>
    <section className="panel request-browser">
      {assignments.length ? assignments.map((assignment) => {
        const displayStatus = assignment.quotation?.status ?? (assignment.expiresAt <= now ? "EXPIRED" : assignment.status);
        return <Link href={`/dashboard/requests/${assignment.quoteRequest.reference}`} className="request-browser-row" key={assignment.id}>
          <span className="status-dot" />
          <div className="request-browser-main"><span className="request-ref">{assignment.quoteRequest.reference}</span><b>{assignment.quoteRequest.title}</b><small>{assignment.quoteRequest.category.name}</small></div>
          <div className="request-browser-meta"><span><MapPin size={14}/>{assignment.quoteRequest.deliveryPostcode}</span><span><Paperclip size={14}/>{assignment.quoteRequest.attachments.length}</span><span><Clock3 size={14}/>{assignment.expiresAt.toLocaleDateString("en-GB")}</span></div>
          <span className={`status-pill ${displayStatus.toLowerCase()}`}>{displayStatus}</span>
        </Link>;
      }) : <div className="empty-state large"><FileText size={28}/><b>No requests in this view</b><p>Requests appear here only when they match the selected recorded state.</p></div>}
    </section>
  </PortalPage>;
}
