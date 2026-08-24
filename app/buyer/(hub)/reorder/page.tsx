import { getBuyerProfile, getBuyerRequests } from "@/lib/buyer/data";

function whatsappNumber() { return (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "447593103459").replace(/\D/g, ""); }

export default async function BuyerReorderPage() {
  const profile = await getBuyerProfile();
  const requests = await getBuyerRequests();
  return <><header className="buyer-page-head"><p className="eyebrow">WhatsApp first</p><h1>Bridge it again</h1><p>Start fresh or use an earlier request as context. Prices and availability are always re-confirmed.</p></header><section className="buyer-panel"><a className="buyer-primary-link" href={`https://wa.me/${whatsappNumber()}?text=${encodeURIComponent("Hi Bridge-iT, I need a new quote.")}`}>Start a new request on WhatsApp</a><h2>Reorder from history</h2>{requests.slice(0, 20).map((request) => <a className="buyer-list-row" key={request.reference} href={`https://wa.me/${whatsappNumber()}?text=${encodeURIComponent(`Hi Bridge-iT, I’d like a fresh quote based on ${request.reference}: ${request.title}. Please re-check current prices and availability${profile.postcode ? ` for ${profile.postcode}` : ""}.`)}`}><span><b>{request.title}</b><small>{request.reference} · a new request will be created</small></span><strong>Reorder</strong></a>)}</section></>;
}
