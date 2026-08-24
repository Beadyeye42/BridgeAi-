import { notFound } from "next/navigation";
import { getBuyerOrder } from "@/lib/buyer/data";
import { lifecycleStage, resolveBuyerExperience } from "@/lib/buyer/industry-experience";

const money = (value: { toString(): string }, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(value));

export default async function BuyerOrderPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const order = await getBuyerOrder(reference);
  if (!order) notFound();
  const supplierName = order.supplierCompany.tradingName ?? order.supplierCompany.legalName;
  const experience = resolveBuyerExperience(order.quoteRequest.category);
  const stage = lifecycleStage(experience, order.stageKey);
  return <><header className="buyer-page-head"><p className="eyebrow">{order.reference}</p><h1>{order.quoteRequest.title}</h1><p>{stage.nextAction ?? order.nextAction ?? "Confirm the final arrangements directly with the selected supplier."}</p></header><div className="buyer-two-column"><section className="buyer-panel"><h2>{experience.labels.orderSingular.replace(/^./, (character) => character.toUpperCase())} details</h2><dl className="buyer-details"><div><dt>Stage</dt><dd>{stage.label}</dd></div><div><dt>Supplier</dt><dd>{supplierName}</dd></div><div><dt>Price</dt><dd>{money(order.quotation.price, order.quotation.currency)}</dd></div><div><dt>Lead time</dt><dd>{order.quotation.leadTimeDays} days</dd></div><div><dt>VAT</dt><dd>{order.quotation.vatIncluded === true ? "Included" : order.quotation.vatIncluded === false ? "Not included" : "Not stated"}</dd></div><div><dt>{experience.labels.location}</dt><dd>{order.quoteRequest.deliveryPostcode}</dd></div></dl><div className="buyer-contact"><h3>Selected supplier contact</h3><p>{order.supplierCompany.contactPhone || "Phone not supplied"}</p><p>{order.supplierCompany.contactEmail || "Email not supplied"}</p></div></section><section className="buyer-panel"><h2>Timeline</h2><ol className="buyer-timeline">{order.events.map((event) => <li key={event.id}><b>{lifecycleStage(experience, event.stageKey).label}</b><span>{event.createdAt.toLocaleString("en-GB")}</span>{event.detail ? <p>{event.detail}</p> : null}</li>)}</ol></section></div></>;
}
