import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, Clock3, FileText, LockKeyhole, Mail, MapPin, MessageSquareText, Paperclip, Phone, ShieldCheck, Trophy, UserRound } from "lucide-react";
import { requireSupplierPage } from "@/lib/auth/guards";
import { getSupplierRequest } from "@/lib/data/supplier-dashboard";
import { getUnlockedCustomerContact } from "@/lib/contacts/access";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import { ConnectedResponse } from "@/components/requests/connected-response";
import { AssignmentViewTracker } from "@/components/requests/assignment-view-tracker";
import { AttachmentList } from "@/components/attachments/attachment-list";
import { categoryResponsibilityNotice } from "@/lib/categories/catalogue";

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
  const isWon = quotation?.status === "ACCEPTED";
  const contact = quotation?.contactAccess
    ? await getUnlockedCustomerContact({ quotationId: quotation.id, companyId, actorUserId: session.userId })
    : null;
  return <PortalPage {...identity(session, company)} eyebrow={request.reference} title={request.title} description={request.category.name}>
    <AssignmentViewTracker assignmentId={assignment.id} status={assignment.status} />
    <Link href="/dashboard/requests" className="back-link request-back"><ArrowLeft size={14}/>Back to requests</Link>
    {isWon && <section className="won-job-banner" role="status"><span><Trophy size={24}/></span><div><p className="eyebrow">Quotation accepted</p><h2>You won this job</h2><p>The customer selected your quotation. Their verified contact details are unlocked below so you can arrange the order.</p></div></section>}
    <div className="request-title-row"><div><div className="request-ref"><span className="status-dot urgent"/>{request.reference}<span className={`tag ${assignment.status.toLowerCase()}`}>{assignment.status}</span></div></div><div className="deadline-box"><Clock3 size={18}/><span>Response deadline<b>{assignment.expiresAt.toLocaleString("en-GB")}</b></span></div></div>
    <div className="request-layout"><div className="request-content">
      <section className="panel request-section"><div className="section-title"><MessageSquareText size={18}/><div><p className="eyebrow">Customer brief</p><h2>Requirements</h2></div></div><p className="request-summary">{request.summary}</p>{responsibilityNotice && <div className="honesty-note">{responsibilityNotice}</div>}{contact ? <div className="privacy-note"><ShieldCheck size={17}/><div><b>Customer contact unlocked</b><p>The customer selected your quotation. Use these details only to fulfil this enquiry.</p></div></div> : <div className="privacy-note"><LockKeyhole size={17}/><div><b>Customer identity protected</b><p>Contact details stay with Bridge AI until the customer selects a quotation.</p></div></div>}</section>
      {contact && <section className="panel request-section"><div className="section-title"><UserRound size={18}/><div><p className="eyebrow">Customer selected</p><h2>Customer contact</h2></div></div><div className="detail-list"><div><dt>Name</dt><dd>{contact.displayName}</dd></div><div><dt><Phone size={13}/> Phone</dt><dd><a href={`tel:${contact.phone}`}>{contact.phone}</a></dd></div>{contact.email && <div><dt><Mail size={13}/> Email</dt><dd><a href={`mailto:${contact.email}`}>{contact.email}</a></dd></div>}</div></section>}
      <section className="panel request-section"><div className="section-title"><FileText size={18}/><div><p className="eyebrow">Bill of requirements</p><h2>Requested items</h2></div></div><div className="items-table">{request.items.map((item,index)=><div className="item-row" key={item.id}><span className="item-number">{String(index+1).padStart(2,"0")}</span><div><b>{item.description}</b><p>{item.specification}</p></div><strong>{Number(item.quantity)} {item.unit}</strong></div>)}</div></section>
      <section className="panel request-section"><div className="section-title"><Paperclip size={18}/><div><p className="eyebrow">{request.attachments.length} files</p><h2>Drawings & attachments</h2></div></div><div className="attachment-grid"><AttachmentList files={request.attachments} emptyMessage="No files were supplied with this enquiry."/></div></section>
    </div><aside className="request-action-rail"><section className="panel action-card"><div className="action-heading"><span><ShieldCheck size={18}/></span><div><p className="eyebrow">Your response</p><h2>Quotation</h2></div></div><ConnectedResponse assignmentId={assignment.id} status={assignment.status} quotationId={quotation?.id} quotationStatus={quotation?.status}/></section><section className="panel request-facts"><h3>Request details</h3><Fact icon={<MapPin size={16}/>} label="Delivery area" value={request.deliveryPostcode}/><Fact icon={<CalendarClock size={16}/>} label="Published" value={request.publishedAt?.toLocaleDateString("en-GB")??"—"}/><Fact icon={<Clock3 size={16}/>} label="Response due" value={request.responseDueAt.toLocaleDateString("en-GB")}/></section></aside></div>
  </PortalPage>;
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="fact-row"><span>{icon}</span><div><small>{label}</small><b>{value}</b></div></div>;
}
