import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, CheckCircle2, Clock3, FileText, Handshake, LockKeyhole, Mail, MapPin, MessageSquareText, Paperclip, Phone, ShieldCheck, UserRound, XCircle } from "lucide-react";
import { requireSupplierPage } from "@/lib/auth/guards";
import { getSupplierRequest } from "@/lib/data/supplier-dashboard";
import { getUnlockedCustomerContact } from "@/lib/contacts/access";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import { ConnectedResponse } from "@/components/requests/connected-response";
import { AssignmentViewTracker } from "@/components/requests/assignment-view-tracker";
import { AttachmentList } from "@/components/attachments/attachment-list";
import { categoryResponsibilityNotice } from "@/lib/categories/catalogue";
import { buyerTypeLabel } from "@/lib/whatsapp/buyer-classification";
import { JobLifecycleControl } from "@/components/requests/job-lifecycle-control";
import { allowedLifecycleTransitions, lifecycleStage, resolveBuyerExperience } from "@/lib/buyer/industry-experience";
import { decryptPrivateValue } from "@/lib/security/encryption";
import { QuoteConversationPanel } from "@/components/requests/quote-conversation";

export const dynamic = "force-dynamic";

export default async function ConnectedRequestPage({ params }: { params: Promise<{ reference: string }> }) {
  const { session, companyId } = await requireSupplierPage();
  const { reference } = await params;
  const assignment = await getSupplierRequest(companyId, reference);
  if (!assignment) notFound();
  const company = session.user.memberships.find((membership) => membership.supplierCompanyId === companyId)!.supplierCompany;
  const request = assignment.quoteRequest;
  const quotation = assignment.quotation;
  const responsibilityNotice = categoryResponsibilityNotice(request.category.slug, request.category.parent?.slug);
  const isSelected = quotation?.status === "ACCEPTED";
  const buyerExperience = resolveBuyerExperience(request.category);
  const orderStage = request.buyerOrder ? lifecycleStage(buyerExperience, request.buyerOrder.stageKey) : null;
  const stageTransitions = request.buyerOrder ? allowedLifecycleTransitions(buyerExperience, request.buyerOrder.stageKey) : [];
  const contact = quotation?.contactAccess
    ? await getUnlockedCustomerContact({ quotationId: quotation.id, companyId, actorUserId: session.userId })
    : null;
  const quoteConversation = quotation?.conversation;
  const questions = quoteConversation?.messages
    .filter((message) => message.sender === "BUYER" && message.status === "DELIVERED")
    .map((message) => ({
      id: message.id,
      body: decryptPrivateValue(message.contentEncrypted),
      createdAt: message.createdAt.toISOString(),
      dueAt: message.questionDueAt?.toISOString() ?? null,
      answer: quoteConversation.messages.find((candidate) => candidate.replyToId === message.id && candidate.sender === "SUPPLIER" && candidate.status !== "BLOCKED")?.contentEncrypted
        ? decryptPrivateValue(quoteConversation.messages.find((candidate) => candidate.replyToId === message.id && candidate.sender === "SUPPLIER" && candidate.status !== "BLOCKED")!.contentEncrypted)
        : null,
    })) ?? [];
  return <PortalPage {...identity(session, company)} eyebrow={request.reference} title={request.title} description={request.category.name}>
    <AssignmentViewTracker assignmentId={assignment.id} status={assignment.status} />
    <Link href="/dashboard/requests" className="back-link request-back"><ArrowLeft size={14}/>Back to requests</Link>
    {isSelected && orderStage && <section className={`won-job-banner lifecycle-${orderStage.state.toLowerCase()}`} role="status"><span>{orderStage.state === "COMPLETED" ? <CheckCircle2 size={24}/> : orderStage.state === "CANCELLED" ? <XCircle size={24}/> : <Handshake size={24}/>}</span><div><p className="eyebrow">{orderStage.label}</p><h2>{orderStage.state === "SELECTED" ? "You’ve been selected" : orderStage.label}</h2><p>{orderStage.description ?? (orderStage.state === "SELECTED" ? "Good news—the buyer has selected your quote to move forward." : "This stage is recorded in the shared arrangement history.")}</p>{orderStage.nextAction && <p><b>Next step:</b> {orderStage.nextAction}</p>}</div></section>}
    <div className="request-title-row"><div><div className="request-ref"><span className="status-dot urgent"/>{request.reference}<span className={`tag ${assignment.status.toLowerCase()}`}>{assignment.status}</span></div></div><div className="deadline-box"><Clock3 size={18}/><span>Response deadline<b>{assignment.expiresAt.toLocaleString("en-GB")}</b></span></div></div>
    <div className="request-layout"><div className="request-content">
      <section className="panel request-section"><div className="section-title"><MessageSquareText size={18}/><div><p className="eyebrow">Customer brief</p><h2>Requirements</h2></div></div><p className="request-summary">{request.summary}</p>{responsibilityNotice && <div className="honesty-note">{responsibilityNotice}</div>}{contact ? <div className="privacy-note"><ShieldCheck size={17}/><div><b>Customer contact unlocked</b><p>The customer selected your quotation. Use these details only to fulfil this enquiry.</p></div></div> : <div className="privacy-note"><LockKeyhole size={17}/><div><b>Customer identity protected</b><p>Contact details stay with Bridge-iT until the customer selects a quotation.</p></div></div>}</section>
      {contact && <section className="panel request-section"><div className="section-title"><UserRound size={18}/><div><p className="eyebrow">Customer selected</p><h2>Customer contact</h2></div></div><div className="detail-list"><div><dt>Name</dt><dd>{contact.displayName}</dd></div><div><dt><Phone size={13}/> Phone</dt><dd><a href={`tel:${contact.phone}`}>{contact.phone}</a></dd></div>{contact.email && <div><dt><Mail size={13}/> Email</dt><dd><a href={`mailto:${contact.email}`}>{contact.email}</a></dd></div>}</div></section>}
      <section className="panel request-section"><div className="section-title"><FileText size={18}/><div><p className="eyebrow">Bill of requirements</p><h2>Requested items</h2></div></div><div className="items-table">{request.items.map((item,index)=><div className="item-row" key={item.id}><span className="item-number">{String(index+1).padStart(2,"0")}</span><div><b>{item.description}</b><p>{item.specification}</p></div><strong>{Number(item.quantity)} {item.unit}</strong></div>)}</div></section>
      <section className="panel request-section"><div className="section-title"><Paperclip size={18}/><div><p className="eyebrow">{request.attachments.length} files</p><h2>Drawings & attachments</h2></div></div><div className="attachment-grid"><AttachmentList files={request.attachments} emptyMessage="No files were supplied with this enquiry."/></div></section>
      {quoteConversation && <QuoteConversationPanel conversationId={quoteConversation.id} anonymousLabel={quoteConversation.anonymousLabel} status={quoteConversation.status} questions={questions}/>}
    </div><aside className="request-action-rail"><section className="panel action-card"><div className="action-heading"><span><ShieldCheck size={18}/></span><div><p className="eyebrow">Your response</p><h2>Quotation</h2></div></div><ConnectedResponse assignmentId={assignment.id} status={assignment.status} quotationStatus={quotation?.status} existing={quotation?{price:quotation.price.toString(),leadTimeDays:quotation.leadTimeDays,validUntil:quotation.validUntil?.toISOString().slice(0,10),notes:quotation.notes??undefined,specification:quotation.specification??undefined,deliveryCost:quotation.deliveryCost?.toString(),collectionAvailable:quotation.collectionAvailable,availability:quotation.availability??undefined,warranty:quotation.warranty??undefined,paymentTerms:quotation.paymentTerms??undefined,assumptions:quotation.assumptions??undefined,exclusions:quotation.exclusions??undefined,vatIncluded:quotation.vatIncluded,versionNumber:quotation.currentVersionNumber}:undefined}/>{isSelected && orderStage && <JobLifecycleControl reference={request.reference} stageLabel={orderStage.label} nextAction={orderStage.nextAction} transitions={stageTransitions}/>}</section><section className="panel request-facts"><h3>Request details</h3><Fact icon={<UserRound size={16}/>} label="Buyer" value={buyerTypeLabel(request.buyerType)}/><Fact icon={<MapPin size={16}/>} label={buyerExperience.labels.location} value={request.deliveryPostcode}/><Fact icon={<CalendarClock size={16}/>} label="Published" value={request.publishedAt?.toLocaleDateString("en-GB")??"—"}/><Fact icon={<Clock3 size={16}/>} label="Response due" value={request.responseDueAt.toLocaleDateString("en-GB")}/></section></aside></div>
  </PortalPage>;
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="fact-row"><span>{icon}</span><div><small>{label}</small><b>{value}</b></div></div>;
}
