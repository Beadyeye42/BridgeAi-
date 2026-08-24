import { notFound } from "next/navigation";
import { BuyerRequestActions } from "@/components/buyer/buyer-request-actions";
import { getBuyerRequest } from "@/lib/buyer/data";
import { configuredRequestDetails, resolveBuyerExperience } from "@/lib/buyer/industry-experience";

const money = (value: { toString(): string }, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(value));

export default async function BuyerRequestPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const request = await getBuyerRequest(reference);
  if (!request) notFound();
  const selectable = ["OPEN", "MATCHING", "QUOTED"].includes(request.status);
  const experience = resolveBuyerExperience(request.category);
  const configuredDetails = configuredRequestDetails(experience, request);
  return <><header className="buyer-page-head"><p className="eyebrow">{request.reference}</p><h1>{request.title}</h1><p>{request.summary}</p></header>
    <div className="buyer-two-column"><div>
      <section className="buyer-panel"><h2>{experience.labels.requestSingular.replace(/^./, (character) => character.toUpperCase())} details</h2><dl className="buyer-details"><div><dt>Status</dt><dd>{request.status.replaceAll("_", " ")}</dd></div><div><dt>Category</dt><dd>{request.category.name}</dd></div><div><dt>{experience.labels.location}</dt><dd>{request.deliveryPostcode}</dd></div><div><dt>{experience.labels.requiredBy}</dt><dd>{request.requiredBy?.toLocaleDateString("en-GB") ?? "Flexible"}</dd></div>{configuredDetails.map((detail) => <div key={detail.key}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>
        <h3>{experience.labels.items}</h3>{request.items.map((item) => <div className="buyer-item" key={item.id}><b>{Number(item.quantity)} {item.unit} — {item.description}</b>{item.specification ? <p>{item.specification}</p> : null}</div>)}
      </section>
      <section className="buyer-panel"><h2>{experience.labels.files}</h2>{request.attachments.map((file) => <a className="buyer-file" href={`/api/attachments/${file.id}/download`} key={file.id}>{file.fileName}<small>{file.mimeType} · {Math.ceil(file.byteSize / 1024)} KB</small></a>)}{!request.attachments.length ? <p>No files were attached.</p> : null}</section>
    </div><div>
      <section className="buyer-panel"><div className="buyer-section-head"><div><p className="eyebrow">Anonymous comparison</p><h2>{experience.labels.quotePlural}</h2></div><span>{request.quotations.length}/5</span></div>
        {request.quotations.map((quote) => <article className="buyer-quote" key={quote.id}><div className="buyer-quote-head"><span>Quote {quote.label}{quote.expired ? " · Expired" : ""}</span><b>{money(quote.price, quote.currency)}</b></div><dl><div><dt>Lead time</dt><dd>{quote.leadTimeDays} days</dd></div><div><dt>Valid until</dt><dd>{quote.validUntil?.toLocaleDateString("en-GB") ?? "Not stated"}</dd></div><div><dt>VAT</dt><dd>{quote.vatIncluded === true ? "Included" : quote.vatIncluded === false ? "Not included" : "Not stated"}</dd></div><div><dt>Delivery</dt><dd>{quote.deliveryCost ? money(quote.deliveryCost, quote.currency) : quote.collectionAvailable ? "Collection available" : "Not stated"}</dd></div></dl>{quote.specification ? <p>{quote.specification}</p> : null}{quote.notes ? <p>{quote.notes}</p> : null}
          {quote.messages.length ? <div className="buyer-conversation">{quote.messages.map((message) => <p key={message.id}><b>{message.sender === "BUYER" ? "You" : `Quote ${quote.label}`}:</b> {message.body}</p>)}</div> : null}</article>)}
        {!request.quotations.length ? <div className="buyer-empty"><h3>No supplier quotes yet</h3><p>We’ll notify you on WhatsApp when prices and lead times arrive.</p></div> : null}
        {request.quotations.length ? <BuyerRequestActions reference={request.reference} quotes={request.quotations.map((quote) => ({ label: quote.label, conversationId: quote.conversation?.id ?? null, selectable: selectable && quote.status === "SUBMITTED" && !quote.expired }))} /> : null}
      </section>
    </div></div>
  </>;
}
