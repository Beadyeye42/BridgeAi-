import { notFound } from "next/navigation";
import { Clock3, FileText, MessageSquareText, Paperclip, ShieldAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { AssignmentForm, RecordCustomerSelection } from "@/components/admin/admin-actions";
import { evaluateSupplierMatches, resolveDeliveryLocation } from "@/lib/matching/suppliers";
import { AttachmentList } from "@/components/attachments/attachment-list";
import { categoryResponsibilityNotice } from "@/lib/categories/catalogue";
import { buyerTypeLabel, intentQualityLabel } from "@/lib/whatsapp/buyer-classification";
import { decryptPrivateValue } from "@/lib/security/encryption";

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
      quoteConversations: {
        include: {
          supplierCompany: { select: { legalName: true, tradingName: true } },
          quotation: { include: { versions: { orderBy: { versionNumber: "desc" } } } },
          messages: { include: { replyTo: { select: { id: true } } }, orderBy: { createdAt: "asc" } },
          moderationEvents: { orderBy: { createdAt: "desc" } },
        },
        orderBy: { anonymousLabel: "asc" },
      },
    },
  });
  if (!request) notFound();
  const responsibilityNotice = categoryResponsibilityNotice(request.category.slug, request.category.parent?.slug);
  const resolution = await resolveDeliveryLocation(request);
  const evaluations = await evaluateSupplierMatches(prisma, request, resolution.location);
  const suppliers = evaluations.filter((evaluation) => evaluation.outcome === "MATCHED"
    || (evaluation.reasons.length === 1 && evaluation.reasons.some((reason) => reason.startsWith("Current capacity is "))));
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
          <div><dt>Buyer</dt><dd>{buyerTypeLabel(request.buyerType)}</dd></div>
          <div><dt>Intent</dt><dd>{intentQualityLabel(request.intentQuality)}</dd></div>
          <div><dt>Budget</dt><dd>{request.customerBudget === null ? "Not supplied" : new Intl.NumberFormat("en-GB", { style: "currency", currency: request.currency }).format(Number(request.customerBudget))}</dd></div>
          <div><dt>Published</dt><dd>{request.publishedAt?.toLocaleString("en-GB") ?? "Not published"}</dd></div>
          <div><dt>Supplier deadline</dt><dd>{request.responseDueAt.toLocaleString("en-GB", { timeZone: "Europe/London" })}</dd></div>
          <div><dt>Market mode</dt><dd>{request.marketDensityMode ?? "Not evaluated"}</dd></div>
          <div><dt>Matching funnel</dt><dd>{request.consideredSupplierCount} considered · {request.eliminatedSupplierCount} eliminated · {request.eligibleSupplierCount} eligible · {request.invitedSupplierCount} invited</dd></div>
          <div><dt>Fairness</dt><dd>{request.fairnessInfluence ?? "No fairness audit recorded"}</dd></div>
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
        <div className="entity-list">{request.assignments.length ? request.assignments.map((assignment) => <article className="entity-row" key={assignment.id}><div><b>{assignment.supplierCompany.tradingName ?? assignment.supplierCompany.legalName}</b><small>Invitation #{assignment.invitationRank} · assigned {assignment.assignedAt.toLocaleString("en-GB")} · responds by {assignment.expiresAt.toLocaleString("en-GB")}{assignment.replacementForId ? " · replacement invitation" : ""}</small>{assignment.quotation?.status === "SUBMITTED" && <RecordCustomerSelection quotationId={assignment.quotation.id}/>}</div><span className={`status-pill ${(assignment.quotation?.status ?? assignment.status).toLowerCase()}`}>{assignment.quotation?.status ?? assignment.status}</span></article>) : <div className="empty-state">No suppliers assigned.</div>}</div>
      </section>
      <section className="panel form-section admin-quote-conversations">
        <div className="section-heading"><div><p className="eyebrow">Private pre-selection messaging</p><h2>Quote conversations</h2></div></div>
        <div className="honesty-note">Suppliers and buyers remain anonymous to one another here. Contact-detail blocks and quotation revisions are retained for administrator oversight.</div>
        <div className="admin-conversation-list">{request.quoteConversations.length ? request.quoteConversations.map((conversation) => {
          const supplierName = conversation.supplierCompany.tradingName ?? conversation.supplierCompany.legalName;
          return <article className="admin-conversation" key={conversation.id}>
            <header><div><span className="quote-label">{conversation.anonymousLabel}</span><div><b>Quote {conversation.anonymousLabel}</b><small>{supplierName} · version {conversation.quotation.currentVersionNumber}</small></div></div><span className={`status-pill ${conversation.status.toLowerCase()}`}>{conversation.status}</span></header>
            <div className="quote-comparison-facts"><span>£{Number(conversation.quotation.price).toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span><span>{conversation.quotation.leadTimeDays} day lead time</span><span>{conversation.quotation.deliveryCost === null ? "Delivery not specified" : `£${Number(conversation.quotation.deliveryCost).toFixed(2)} delivery`}</span><span>{conversation.quotation.collectionAvailable ? "Collection available" : "Delivery only"}</span></div>
            <div className="admin-message-list">{conversation.messages.length ? conversation.messages.map((message) => <div className={`admin-message sender-${message.sender.toLowerCase()}`} key={message.id}><div><b>{message.sender === "BUYER" ? "Buyer" : message.sender === "SUPPLIER" ? `Quote ${conversation.anonymousLabel}` : "Bridge-iT"}</b><time>{message.createdAt.toLocaleString("en-GB")}</time></div><p>{decryptPrivateValue(message.contentEncrypted)}</p>{message.questionDueAt && <small><Clock3 size={12}/> Reply due {message.questionDueAt.toLocaleString("en-GB")}{message.answeredAt ? " · answered" : ""}</small>}</div>) : <div className="empty-state">No questions have been exchanged.</div>}</div>
            {conversation.moderationEvents.some((event) => event.outcome === "BLOCKED") && <div className="moderation-summary"><ShieldAlert size={15}/><span>{conversation.moderationEvents.filter((event) => event.outcome === "BLOCKED").length} message attempt(s) blocked for privacy. {Array.from(new Set(conversation.moderationEvents.flatMap((event) => event.reasons))).join(" · ")}</span></div>}
          </article>;
        }) : <div className="empty-state">Conversations appear after suppliers submit quotations.</div>}</div>
      </section>
      <section className="panel form-section">
        <div className="section-heading"><div><p className="eyebrow">Recorded matching evidence</p><h2>Why suppliers were selected</h2></div></div>
        <div className="entity-list">{request.matchDecisions.length ? request.matchDecisions.map((decision) => {
          const reasons = Array.isArray(decision.reasons) ? decision.reasons.filter((reason): reason is string => typeof reason === "string") : [];
          return <article className="entity-row" key={decision.id}><div><b>{decision.supplierCompany.tradingName ?? decision.supplierCompany.legalName}</b><small>{[decision.marketDensityMode, decision.membershipTier, decision.coveragePurpose ? `${decision.coveragePurpose.toLowerCase()} coverage` : null, decision.distanceMiles ? `${Number(decision.distanceMiles).toFixed(1)} miles` : null, `base ${decision.baseScore}`, decision.fairnessAdjustment.gt(0) ? `fairness +${decision.fairnessAdjustment.toString()}` : null].filter(Boolean).join(" · ")}</small><small>{decision.invitationReason ?? decision.rejectionReason ?? (reasons.join(" · ") || "No explanation recorded")}</small></div><span className={`status-pill ${decision.selected ? "accepted" : decision.outcome.toLowerCase()}`}>{decision.selected ? `Selected · ${decision.score}` : `${decision.outcome} · ${decision.score}`}</span></article>;
        }) : <div className="empty-state">This request predates recorded capability matching.</div>}</div>
      </section>
      <section className="panel form-section">
        <div className="section-heading"><div><p className="eyebrow">Category and delivery matches</p><h2>Assign suppliers</h2></div></div>
        {resolution.warning && <div className="honesty-note">{resolution.warning} Postcode-area and nationwide rules are still checked.</div>}
        <AssignmentForm requestId={request.id} distributionLimit={request.distributionLimit} currentCount={request.assignments.length} responseDueAt={request.responseDueAt.toLocaleString("en-GB", { timeZone: "Europe/London" })} suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, postcode: supplier.postcode, matchDescription: `${supplier.score}/100 · ${supplier.reasons.join(" · ")}`, capacityOverrideRequired: supplier.outcome === "REJECTED" }))}/>
      </section>
    </div>
  </>;
}
