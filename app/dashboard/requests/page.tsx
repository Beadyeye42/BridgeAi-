import Link from "next/link";
import { CheckCircle2, Clock3, FileText, Handshake, MapPin, Paperclip } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import { isMembershipActive } from "@/lib/billing/pricing";
import { lifecycleDisplay } from "@/lib/quotes/lifecycle";
import { canReadSupplierAssignment } from "@/lib/billing/opportunity-access";

export const dynamic = "force-dynamic";
const views = ["new", "submitted", "selected", "confirmed", "completed", "lost", "expired", "all"] as const;
type View = typeof views[number];

function viewFilter(view: View, now: Date): Prisma.SupplierAssignmentWhereInput {
  switch (view) {
    case "new":
      return {
        status: { in: ["PENDING", "VIEWED", "ACCEPTED"] },
        expiresAt: { gt: now },
        quotation: null,
        quoteRequest: { status: { in: ["OPEN", "MATCHING", "QUOTED"] }, responseDueAt: { gt: now } },
      };
    case "submitted":
      return { quotation: { status: { in: ["SUBMITTED", "SELECTED_PENDING_PAYMENT"] } } };
    case "selected":
      return { quotation: { status: "ACCEPTED" }, quoteRequest: { status: { in: ["SELECTED", "WON"] } } };
    case "confirmed":
      return { quotation: { status: "ACCEPTED" }, quoteRequest: { status: "CONFIRMED" } };
    case "completed":
      return { quotation: { status: "ACCEPTED" }, quoteRequest: { status: "COMPLETED" } };
    case "lost":
      return { quotation: { status: "REJECTED" } };
    case "expired":
      return { OR: [{ status: "EXPIRED" }, { expiresAt: { lte: now } }, { quotation: { status: "EXPIRED" } }, { quoteRequest: { status: "EXPIRED" } }] };
    default:
      return { OR: [{ status: { not: "WITHDRAWN" } }, { quotation: { isNot: null } }] };
  }
}

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { session, companyId } = await requireSupplierPage();
  const company = await prisma.supplierCompany.findUniqueOrThrow({
    where: { id: companyId },
    include: { subscription: { include: { membershipPlan: true } } },
  });
  const raw = (await searchParams).view;
  const view: View = views.includes(raw as View) ? raw as View : "new";
  const now = new Date();
  const membershipActive = isMembershipActive(company.subscription, now);
  const candidates = await prisma.supplierAssignment.findMany({
    where: { supplierCompanyId: companyId, ...viewFilter(view, now) },
    include: { quoteRequest: { include: { category: true, attachments: { select: { id: true } } } }, quotation: true },
    orderBy: { assignedAt: "desc" },
    take: 500,
  });
  const assignments = candidates.filter((assignment) => canReadSupplierAssignment(company, assignment, now)).slice(0, 100);

  return <PortalPage {...identity(session, company)} eyebrow="Capability-matched requests" title="Bridge Requests" description="Only requests assigned to this supplier company are shown. New matches use confirmed products, coverage, deadlines, lead times and live capacity.">
    {!membershipActive && <section className="panel honesty-note" role="status"><b>Membership required for live quote opportunities</b><p>Your paid access has ended. Existing submitted, selected and closed quotations remain available as read-only history, but new opportunities and quotation submission are locked.</p><Link className="button button-dark" href="/dashboard/subscription">Renew membership</Link></section>}
    <nav className="filter-tabs">{views.map((item) => <Link className={item === view ? "active" : ""} href={`/dashboard/requests?view=${item}`} key={item}>{item}</Link>)}</nav>
    <section className="panel request-browser">
      {assignments.length ? assignments.map((assignment) => {
        const isSelected = assignment.quotation?.status === "ACCEPTED";
        const lifecycle = lifecycleDisplay(assignment.quoteRequest.status);
        const displayStatus = isSelected ? lifecycle : assignment.quotation?.status ?? (assignment.expiresAt <= now ? "EXPIRED" : assignment.status);
        return <Link href={`/dashboard/requests/${assignment.quoteRequest.reference}`} className={`request-browser-row${isSelected ? " is-won" : ""}`} key={assignment.id}>
          {isSelected ? <span className="won-row-icon">{assignment.quoteRequest.status === "COMPLETED" ? <CheckCircle2 size={17}/> : <Handshake size={17}/>}</span> : <span className="status-dot" />}
          <div className="request-browser-main"><span className="request-ref">{assignment.quoteRequest.reference}</span><b>{assignment.quoteRequest.title}</b><small>{assignment.quoteRequest.category.name}</small></div>
          <div className="request-browser-meta"><span><MapPin size={14}/>{assignment.quoteRequest.deliveryPostcode}</span><span><Paperclip size={14}/>{assignment.quoteRequest.attachments.length}</span><span><Clock3 size={14}/>{assignment.expiresAt.toLocaleDateString("en-GB")}</span></div>
          <span className={`status-pill ${isSelected ? "selected" : displayStatus.toLowerCase().replaceAll(" ", "-")}`}>{displayStatus}</span>
        </Link>;
      }) : <div className="empty-state large"><FileText size={28}/><b>No requests in this view</b><p>New work appears after Bridge AI records a suitable capability and capacity match for your company.</p></div>}
    </section>
  </PortalPage>;
}
