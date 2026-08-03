import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, Clock3, Download, FileImage, FileText, LockKeyhole, Mail, MapPin, MessageSquareText, Paperclip, Phone, ShieldCheck, UserRound } from "lucide-react";
import { requireSupplierPage } from "@/lib/auth/guards";
import { getSupplierRequest } from "@/lib/data/supplier-dashboard";
import { getUnlockedCustomerContact } from "@/lib/contacts/access";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import { ConnectedResponse } from "@/components/requests/connected-response";
import { AssignmentViewTracker } from "@/components/requests/assignment-view-tracker";

export const dynamic = "force-dynamic";

export default async function ConnectedRequestPage({ params }: { params: Promise<{ reference: string }> }) {
  const { session, companyId } = await requireSupplierPage();
  const { reference } = await params;
  const assignment = await getSupplierRequest(companyId, reference);
  if (!assignment) notFound();
  const request = assignment.quoteRequest;
  const quotation = assignment.quotation;
  const contact = quotation?.contactAccess
    ? await getUnlockedCustomerContact({ quotationId: quotation.id, companyId, actorUserId: session.userId })
    : null;
  const company = session.user.memberships.find((membership) => membership.supplierCompanyId === companyId)!.supplierCompany;
  return <PortalPage {...identity(session, company)} eyebrow={request.reference} title={request.title} description={request.category.name}>
    <AssignmentViewTracker assignmentId={assignment.id} status={assignment.status} />
    <Link href="/dashboard/requests" className="back-link request-back"><ArrowLeft size={14}/>Back to requests</Link>
    <div className="request-title-row"><div><div className="request-ref"><span className="status-dot urgent"/>{request.reference}<span className={`tag ${assignment.status.toLowerCase()}`}>{assignment.status}</span></div></div><div className="deadline-box"><Clock3 size={18}/><span>Response deadline<b>{assignment.expiresAt.toLocaleString("en-GB")}</b></span></div></div>
    <div className="request-layout"><div className="request-content">
      <section className="panel request-section"><div className="section-title"><MessageSquareText size={18}/><div><p className="eyebrow">Customer brief</p><h2>Requirements</h2></div></div><p className="request-summary">{request.summary}</p>{contact ? <div className="privacy-note"><ShieldCheck size={17}/><div><b>Customer contact unlocked</b><p>Payment is verified. Use these details only to fulfil this enquiry.</p></div></div> : <div className="privacy-note"><LockKeyhole size={17}/><div><b>Customer identity protected</b><p>Contact details stay with Bridge AI until the selected supplier pays the success fee.</p></div></div>}</section>
      {contact && <section className="panel request-section"><div className="section-title"><UserRound size={18}/><div><p className="eyebrow">Payment verified</p><h2>Customer contact</h2></div></div><div className="detail-list"><div><dt>Name</dt><dd>{contact.displayName}</dd></div><div><dt><Phone size={13}/> Phone</dt><dd><a href={`tel:${contact.phone}`}>{contact.phone}</a></dd></div>{contact.email && <div><dt><Mail size={13}/> Email</dt><dd><a href={`mailto:${contact.email}`}>{contact.email}</a></dd></div>}</div></section>}
      <section className="panel request-section"><div className="section-title"><FileText size={18}/><div><p className="eyebrow">Bill of requirements</p><h2>Requested items</h2></div></div><div className="items-table">{request.items.map((item,index)=><div className="item-row" key={item.id}><span className="item-number">{String(index+1).padStart(2,"0")}</span><div><b>{item.description}</b><p>{item.specification}</p></div><strong>{Number(item.quantity)} {item.unit}</strong></div>)}</div></section>
      <section className="panel request-section"><div className="section-title"><Paperclip size={18}/><div><p className="eyebrow">{request.attachments.length} files</p><h2>Drawings & attachments</h2></div></div><div className="attachment-grid">{request.attachments.length ? request.attachments.map((file)=>file.scanStatus==="CLEAN" ? <a className="attachment-file" href={`/api/attachments/${file.id}/download`} key={file.id}><span>{file.mimeType==="application/pdf"?<FileText size={19}/>:<FileImage size={19}/>}</span><div><b>{file.fileName}</b><small>{file.mimeType} · {Math.ceil(file.byteSize/1024)} KB</small></div><Download size={16}/></a> : <div className="attachment-file locked" key={file.id}><ShieldCheck size={18}/><div><b>{file.fileName}</b><small>Security check: {file.scanStatus.toLowerCase()}</small></div></div>) : <div className="empty-state">No files were supplied with this enquiry.</div>}</div></section>
    </div><aside className="request-action-rail"><section className="panel action-card"><div className="action-heading"><span><ShieldCheck size={18}/></span><div><p className="eyebrow">Your response</p><h2>Quotation</h2></div></div><ConnectedResponse assignmentId={assignment.id} status={assignment.status} quotationId={quotation?.id} quotationStatus={quotation?.status} successFee={quotation?.successFee ? { id: quotation.successFee.id, status: quotation.successFee.status, paymentDueAt: quotation.successFee.paymentDueAt.toISOString() } : undefined}/></section><section className="panel request-facts"><h3>Request details</h3><Fact icon={<MapPin size={16}/>} label="Delivery area" value={request.deliveryPostcode}/><Fact icon={<CalendarClock size={16}/>} label="Published" value={request.publishedAt?.toLocaleDateString("en-GB")??"—"}/><Fact icon={<Clock3 size={16}/>} label="Response due" value={request.responseDueAt.toLocaleDateString("en-GB")}/></section></aside></div>
  </PortalPage>;
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="fact-row"><span>{icon}</span><div><small>{label}</small><b>{value}</b></div></div>;
}
