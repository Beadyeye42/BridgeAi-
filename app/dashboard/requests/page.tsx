import Link from "next/link";
import { Clock3, FileText, MapPin, Paperclip, Trophy } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";

export const dynamic = "force-dynamic";
const views = ["new", "submitted", "won", "lost", "expired", "all"] as const;
type View = typeof views[number];

function viewFilter(view: View, now: Date): Prisma.SupplierAssignmentWhereInput {
  switch (view) {
    case "new":
      return { status: { in: ["PENDING", "VIEWED", "ACCEPTED"] }, expiresAt: { gt: now }, quotation: null };
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
  const assignments = await prisma.supplierAssignment.findMany({
    where: { supplierCompanyId: companyId, ...viewFilter(view, now) },
    include: { quoteRequest: { include: { category: true, attachments: { select: { id: true } } } }, quotation: true },
    orderBy: { assignedAt: "desc" },
    take: 100,
  });

  return <PortalPage {...identity(session, company)} eyebrow="Capability-matched requests" title="Quote requests" description="Only requests assigned to this supplier company are shown. New matches use confirmed products, coverage, lead times and capacity.">
    <nav className="filter-tabs">{views.map((item) => <Link className={item === view ? "active" : ""} href={`/dashboard/requests?view=${item}`} key={item}>{item}</Link>)}</nav>
    <section className="panel request-browser">
      {assignments.length ? assignments.map((assignment) => {
        const isWon = assignment.quotation?.status === "ACCEPTED";
        const displayStatus = isWon ? "YOU WON" : assignment.quotation?.status ?? (assignment.expiresAt <= now ? "EXPIRED" : assignment.status);
        return <Link href={`/dashboard/requests/${assignment.quoteRequest.reference}`} className={`request-browser-row${isWon ? " is-won" : ""}`} key={assignment.id}>
          {isWon ? <span className="won-row-icon"><Trophy size={17}/></span> : <span className="status-dot" />}
          <div className="request-browser-main"><span className="request-ref">{assignment.quoteRequest.reference}</span><b>{assignment.quoteRequest.title}</b><small>{assignment.quoteRequest.category.name}</small></div>
          <div className="request-browser-meta"><span><MapPin size={14}/>{assignment.quoteRequest.deliveryPostcode}</span><span><Paperclip size={14}/>{assignment.quoteRequest.attachments.length}</span><span><Clock3 size={14}/>{assignment.expiresAt.toLocaleDateString("en-GB")}</span></div>
          <span className={`status-pill ${isWon ? "won" : displayStatus.toLowerCase()}`}>{displayStatus}</span>
        </Link>;
      }) : <div className="empty-state large"><FileText size={28}/><b>No requests in this view</b><p>New work appears after Bridge AI records a suitable capability and capacity match for your company.</p></div>}
    </section>
  </PortalPage>;
}
