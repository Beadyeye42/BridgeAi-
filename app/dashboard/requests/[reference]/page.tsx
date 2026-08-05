import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, Clock3, FileText, LockKeyhole, Mail, MapPin, MessageSquareText, PackageCheck, Paperclip, Phone, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { requireSupplierPage } from "@/lib/auth/guards";
import { getSupplierOpportunity, getSupplierRequest } from "@/lib/data/supplier-dashboard";
import { getUnlockedCustomerContact } from "@/lib/contacts/access";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import { ConnectedResponse } from "@/components/requests/connected-response";
import { AssignmentViewTracker } from "@/components/requests/assignment-view-tracker";
import { ClaimOpportunity } from "@/components/requests/claim-opportunity";
import { prisma } from "@/lib/db";
import { AttachmentList } from "@/components/attachments/attachment-list";

export const dynamic = "force-dynamic";

export default async function ConnectedRequestPage({ params }: { params: Promise<{ reference: string }> }) {
  const { session, companyId } = await requireSupplierPage();
  const { reference } = await params;
  const assignment = await getSupplierRequest(companyId, reference);
  const opportunity = assignment ? null : await getSupplierOpportunity(reference);
  if (!assignment && !opportunity) notFound();
  const company = session.user.memberships.find((membership) => membership.supplierCompanyId === companyId)!.supplierCompany;
  const subscription = await prisma.subscription.findUnique({ where: { supplierCompanyId: companyId } });
  const subscriptionActive = subscription?.status === "ACTIVE"
    && (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > new Date());

  if (opportunity) {
    const available = Math.max(0, opportunity.distributionLimit - opportunity.claimedSlots);
    return <PortalPage {...identity(session, company)} eyebrow={opportunity.reference} title={opportunity.title} description={opportunity.category.name}>
      <Link href="/dashboard/requests" className="back-link request-back"><ArrowLeft size={14}/>Back to opportunities</Link>
      <div className="request-title-row"><div><div className="request-ref"><span className="status-dot urgent"/>{opportunity.reference}<span className="tag new">Open</span></div></div><div className="deadline-box"><Clock3 size={18}/><span>Response deadline<b>{opportunity.responseDueAt.toLocaleString("en-GB")}</b></span></div></div>
      <div className="request-layout"><div className="request-content">
        <section className="panel request-section"><div className="section-title"><PackageCheck size={18}/><div><p className="eyebrow">Safe job summary</p><h2>Opportunity overview</h2></div></div><p className="request-summary">A customer has requested quotations for this {opportunity.category.name.toLowerCase()} job in the {opportunity.deliveryArea} area. The full requirements are reserved for eligible suppliers who claim a place.</p><div className="privacy-note"><LockKeyhole size={17}/><div><b>Customer information is protected</b><p>The exact postcode, detailed brief, drawings, photos and PDFs remain locked until an approved, subscribed company claims one of the available places.</p></div></div></section>
        <section className="panel request-section"><div className="section-title"><FileText size={18}/><div><p className="eyebrow">Information received</p><h2>Quote pack contents</h2></div></div><div className="items-table"><div className="item-row"><span className="item-number">01</span><div><b>Requested items</b><p>Descriptions, quantities and specifications unlock after claiming.</p></div><strong>{opportunity.itemCount} items</strong></div><div className="item-row"><span className="item-number">02</span><div><b>Customer files</b><p>Security-checked drawings, photos and PDFs unlock after claiming.</p></div><strong>{opportunity.attachmentCount} files</strong></div></div></section>
      </div><aside className="request-action-rail"><section className="panel action-card"><div className="action-heading"><span><ShieldCheck size={18}/></span><div><p className="eyebrow">Supplier place</p><h2>{available ? "Quote this job" : "Places filled"}</h2></div></div>{available === 0 ? <div className="decision-state"><span><UsersRound size={17}/></span><b>All places have been taken</b><p>This request has reached its supplier limit.</p></div> : company.status !== "APPROVED" ? <div><p>You can browse safe lead summaries now. Bridge AI must approve your supplier account before you can claim a place.</p><Link className="button button-dark action-primary" href="/dashboard/company">Review company profile</Link></div> : subscriptionActive ? <ClaimOpportunity reference={opportunity.reference}/> : <div><p>You can browse opportunities free. An active £5 monthly membership is required only when you choose to quote.</p><Link className="button button-dark action-primary" href="/dashboard/subscription">Subscribe to claim a place</Link></div>}</section><section className="panel request-facts"><h3>Opportunity details</h3><Fact icon={<MapPin size={16}/>} label="Delivery area" value={`${opportunity.deliveryArea} area`}/><Fact icon={<UsersRound size={16}/>} label="Places available" value={`${available} of ${opportunity.distributionLimit}`}/><Fact icon={<CalendarClock size={16}/>} label="Published" value={opportunity.publishedAt.toLocaleDateString("en-GB")}/><Fact icon={<Clock3 size={16}/>} label="Response due" value={opportunity.responseDueAt.toLocaleString("en-GB")}/></section></aside></div>
    </PortalPage>;
  }

  if (!assignment) notFound();
  const request = assignment.quoteRequest;
  const quotation = assignment.quotation;
  const contact = quotation?.contactAccess
    ? await getUnlockedCustomerContact({ quotationId: quotation.id, companyId, actorUserId: session.userId })
    : null;
  return <PortalPage {...identity(session, company)} eyebrow={request.reference} title={request.title} description={request.category.name}>
    <AssignmentViewTracker assignmentId={assignment.id} status={assignment.status} />
    <Link href="/dashboard/requests" className="back-link request-back"><ArrowLeft size={14}/>Back to requests</Link>
    <div className="request-title-row"><div><div className="request-ref"><span className="status-dot urgent"/>{request.reference}<span className={`tag ${assignment.status.toLowerCase()}`}>{assignment.status}</span></div></div><div className="deadline-box"><Clock3 size={18}/><span>Response deadline<b>{assignment.expiresAt.toLocaleString("en-GB")}</b></span></div></div>
    <div className="request-layout"><div className="request-content">
      <section className="panel request-section"><div className="section-title"><MessageSquareText size={18}/><div><p className="eyebrow">Customer brief</p><h2>Requirements</h2></div></div><p className="request-summary">{request.summary}</p>{contact ? <div className="privacy-note"><ShieldCheck size={17}/><div><b>Customer contact unlocked</b><p>Payment is verified. Use these details only to fulfil this enquiry.</p></div></div> : <div className="privacy-note"><LockKeyhole size={17}/><div><b>Customer identity protected</b><p>Contact details stay with Bridge AI until the selected supplier pays the success fee.</p></div></div>}</section>
      {contact && <section className="panel request-section"><div className="section-title"><UserRound size={18}/><div><p className="eyebrow">Payment verified</p><h2>Customer contact</h2></div></div><div className="detail-list"><div><dt>Name</dt><dd>{contact.displayName}</dd></div><div><dt><Phone size={13}/> Phone</dt><dd><a href={`tel:${contact.phone}`}>{contact.phone}</a></dd></div>{contact.email && <div><dt><Mail size={13}/> Email</dt><dd><a href={`mailto:${contact.email}`}>{contact.email}</a></dd></div>}</div></section>}
      <section className="panel request-section"><div className="section-title"><FileText size={18}/><div><p className="eyebrow">Bill of requirements</p><h2>Requested items</h2></div></div><div className="items-table">{request.items.map((item,index)=><div className="item-row" key={item.id}><span className="item-number">{String(index+1).padStart(2,"0")}</span><div><b>{item.description}</b><p>{item.specification}</p></div><strong>{Number(item.quantity)} {item.unit}</strong></div>)}</div></section>
      <section className="panel request-section"><div className="section-title"><Paperclip size={18}/><div><p className="eyebrow">{request.attachments.length} files</p><h2>Drawings & attachments</h2></div></div><div className="attachment-grid"><AttachmentList files={request.attachments} emptyMessage="No files were supplied with this enquiry."/></div></section>
    </div><aside className="request-action-rail"><section className="panel action-card"><div className="action-heading"><span><ShieldCheck size={18}/></span><div><p className="eyebrow">Your response</p><h2>Quotation</h2></div></div><ConnectedResponse assignmentId={assignment.id} status={assignment.status} quotationId={quotation?.id} quotationStatus={quotation?.status} successFee={quotation?.successFee ? { id: quotation.successFee.id, status: quotation.successFee.status, paymentDueAt: quotation.successFee.paymentDueAt.toISOString() } : undefined}/></section><section className="panel request-facts"><h3>Request details</h3><Fact icon={<MapPin size={16}/>} label="Delivery area" value={request.deliveryPostcode}/><Fact icon={<CalendarClock size={16}/>} label="Published" value={request.publishedAt?.toLocaleDateString("en-GB")??"—"}/><Fact icon={<Clock3 size={16}/>} label="Response due" value={request.responseDueAt.toLocaleDateString("en-GB")}/></section></aside></div>
  </PortalPage>;
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="fact-row"><span>{icon}</span><div><small>{label}</small><b>{value}</b></div></div>;
}
