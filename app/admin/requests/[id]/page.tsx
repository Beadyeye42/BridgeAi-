import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { AssignmentForm, RecordCustomerSelection } from "@/components/admin/admin-actions";
import { findSupplierMatches, resolveDeliveryLocation } from "@/lib/matching/suppliers";

export default async function AdminRequestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const request = await prisma.quoteRequest.findUnique({
    where: { id },
    include: { category: true, assignments: { include: { supplierCompany: true, quotation: { include: { successFee: true } } } }, items: true },
  });
  if (!request) notFound();
  const resolution = await resolveDeliveryLocation(request);
  const suppliers = await findSupplierMatches(prisma, request, resolution.location);
  return <><AdminHeading eyebrow={request.reference} title={request.title} description={`${request.category.name} · delivery ${request.deliveryPostcode}`}/><div className="management-grid"><section className="panel form-section"><div className="section-heading"><div><p className="eyebrow">Supplier responses</p><h2>Distribution</h2></div></div><div className="entity-list">{request.assignments.length ? request.assignments.map((assignment)=><article className="entity-row" key={assignment.id}><div><b>{assignment.supplierCompany.tradingName??assignment.supplierCompany.legalName}</b><small>Assigned {assignment.assignedAt.toLocaleString("en-GB")} · responds by {assignment.expiresAt.toLocaleString("en-GB")}</small>{assignment.quotation?.status==="SUBMITTED"&&<RecordCustomerSelection quotationId={assignment.quotation.id}/>} {assignment.quotation?.successFee&&<small>£25 fee: {assignment.quotation.successFee.status} · due {assignment.quotation.successFee.paymentDueAt.toLocaleString("en-GB")}</small>}</div><span className={`status-pill ${(assignment.quotation?.status??assignment.status).toLowerCase()}`}>{assignment.quotation?.status??assignment.status}</span></article>) : <div className="empty-state">No suppliers assigned.</div>}</div></section><section className="panel form-section"><div className="section-heading"><div><p className="eyebrow">Category and delivery matches</p><h2>Assign suppliers</h2></div></div>{resolution.warning&&<div className="honesty-note">{resolution.warning} Postcode-area and nationwide rules are still checked.</div>}<AssignmentForm requestId={request.id} distributionLimit={request.distributionLimit} currentCount={request.assignments.length} responseDueAt={request.responseDueAt.toLocaleString("en-GB",{timeZone:"Europe/London"})} suppliers={suppliers.map((supplier)=>({id:supplier.id,name:supplier.name,postcode:supplier.postcode,matchDescription:supplier.match.description}))}/></section></div></>;
}
