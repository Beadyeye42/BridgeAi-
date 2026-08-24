import Link from "next/link";
import { getBuyerRequests } from "@/lib/buyer/data";

export default async function BuyerRequestsPage() {
  const requests = await getBuyerRequests();
  return <><header className="buyer-page-head"><p className="eyebrow">Request history</p><h1>My requests</h1><p>Every confirmed WhatsApp request, quote and outcome in one place.</p></header><section className="buyer-panel">
    {requests.map((request) => <Link className="buyer-list-row" href={`/buyer/requests/${request.reference}`} key={request.reference}><span><b>{request.title}</b><small>{request.reference} · {request.deliveryPostcode} · {request._count.quotations} quote{request._count.quotations === 1 ? "" : "s"} · {request._count.attachments} file{request._count.attachments === 1 ? "" : "s"}</small></span><strong>{request.status.replaceAll("_", " ")}</strong></Link>)}
    {!requests.length ? <div className="buyer-empty"><h3>No confirmed requests</h3><p>Your WhatsApp requests will appear here after you confirm them.</p></div> : null}
  </section></>;
}
