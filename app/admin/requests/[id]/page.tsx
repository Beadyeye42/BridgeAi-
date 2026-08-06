import { notFound } from "next/navigation";
import { FileText, MessageSquareText, Paperclip } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { AssignmentForm, RecordCustomerSelection } from "@/components/admin/admin-actions";
import { findSupplierMatches, resolveDeliveryLocation } from "@/lib/matching/suppliers";
import { AttachmentList } from "@/components/attachments/attachment-list";
import { categoryResponsibilityNotice } from "@/lib/categories/catalogue";

export default async function AdminRequestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const request = await prisma.quoteRequest.findUnique({
    where: { id },
    include: {
      category: { include: { parent: { select: { slug: true } } } },
      attachments: { orderBy: { createdAt: "asc" } },
      assignments: {
        include: { supplierCompany: true, quotation: true },
      },
      matchDecisions: {
        include: { supplierCompany: true },
        orderBy: [{ selected: "desc" }, { score: "desc" }],
      },
      items: { orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!request) notFound();
  const responsibilityNotice = categoryResponsibilityNotice(request.category.slug, request.category.parent?.slug);
  const resolution = await resolveDeliveryLocation(request);
  const suppliers = await findSupplierMatches(prisma, request, resolution.location);
  return <>
    <AdminHeading
      eyebrow={request.reference}
      title={request.title}
      description={`${request.category.name} · delivery ${request.deliveryPostcode}`}
    />
    <div className="management-grid">
      <section className="panel request-section">
        <div className="section-title"><MessageSquareText size={18}/><div><p className="eyebrow">{request.customerConfirmationMessageId ? "Confirmed through WhatsApp" : "Portal request"}</p><h2>Customer brief</h2></div></div>
        <p className="request-summary">{request.summary}</p>
        {responsibilityNotice && <div className="honesty-note">{responsibilityNotice}</div>}
        <div className="detail-list">
          <div><dt>Budget</dt><dd>{request.customerBudget === null ? "Not supplied" : new Intl.NumberFormat("en-GB", { style: "currency", currency: request.currency }).format(Number(request.customerBudget))}</dd></div>
          <div><dt>Published</dt><dd>{request.publishedAt?.toLocaleString("en-GB") ?? "Not published"}</dd></div>
          <div><dt>Supplier deadline</dt><dd>{request.responseDueAt.toLocaleString("en-GB", { timeZone: "Europe/London" })}</dd></div>
        </div>
      </section>
      <section className="panel request-section">
        <div className="section-title"><FileText size={18}/><div><p className="eyebrow">{request.items.length} line items</p><h2>Requested items</h2></div></div>
        <div className="items-table">{request.items.map((item, index) => <div className="item-row" key={item.id}><span className="item-number">{String(index + 1).padStart(2, "0")}</span><div><b>{item.description}</b><p>{item.specification || "No further specification supplied"}</p></div><strong>{Number(item.quantity)} {item.unit}</strong></div>)}</div>
      </section>
      <section className="panel request-section">
        <div className="section-title"><Paperclip size={18}/><div><p className="eyebrow">{request.attachments.length} files</p><h2>Customer attachments</h2></div></div>
        <div className="attachment-grid"><AttachmentList files={request.attachments} emptyMessage="No files were supplied with this enquiry." canSanitizeImages/></div>
      </section>
      <section className="panel form-section">
        <div className="section-heading"><div><p className="eyebrow">Supplier responses</p><h2>Distribution</h2></div></div>
        <div className="entity-list">{request.assignments.length ? request.assignments.map((assignment) => <article className="entity-row" key={assignment.id}><div><b>{assignment.supplierCompany.tradingName ?? assignment.supplierCompany.legalName}</b><small>Assigned {assignment.assignedAt.toLocaleString("en-GB")} · responds by {assignment.expiresAt.toLocaleString("en-GB")}</small>{assignment.quotation?.status === "SUBMITTED" && <RecordCustomerSelection quotationId={assignment.quotation.id}/>}</div><span className={`status-pill ${(assignment.quotation?.status ?? assignment.status).toLowerCase()}`}>{assignment.quotation?.status ?? assignment.status}</span></article>) : <div className="empty-state">No suppliers assigned.</div>}</div>
      </section>
      <section className="panel form-section">
        <div className="section-heading"><div><p className="eyebrow">Recorded matching evidence</p><h2>Why suppliers were selected</h2></div></div>
        <div className="entity-list">{request.matchDecisions.length ? request.matchDecisions.map((decision) => {
          const reasons = Array.isArray(decision.reasons) ? decision.reasons.filter((reason): reason is string => typeof reason === "string") : [];
          return <article className="entity-row" key={decision.id}><div><b>{decision.supplierCompany.tradingName ?? decision.supplierCompany.legalName}</b><small>{reasons.join(" · ") || "No explanation recorded"}</small></div><span className={`status-pill ${decision.selected ? "accepted" : decision.outcome.toLowerCase()}`}>{decision.selected ? `Selected · ${decision.score}` : `${decision.outcome} · ${decision.score}`}</span></article>;
        }) : <div className="empty-state">This request predates recorded capability matching.</div>}</div>
      </section>
      <section className="panel form-section">
        <div className="section-heading"><div><p className="eyebrow">Category and delivery matches</p><h2>Assign suppliers</h2></div></div>
        {resolution.warning && <div className="honesty-note">{resolution.warning} Postcode-area and nationwide rules are still checked.</div>}
        <AssignmentForm requestId={request.id} distributionLimit={request.distributionLimit} currentCount={request.assignments.length} responseDueAt={request.responseDueAt.toLocaleString("en-GB", { timeZone: "Europe/London" })} suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, postcode: supplier.postcode, matchDescription: `${supplier.score}/100 · ${supplier.reasons.join(" · ")}` }))}/>
      </section>
    </div>
  </>;
}
