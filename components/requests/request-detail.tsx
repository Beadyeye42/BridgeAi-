"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Check, CheckCircle2, Clock3, FileImage, FileText, LockKeyhole, MapPin, MessageSquareText, Paperclip, PoundSterling, Send, ShieldCheck, Truck, X } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Sidebar } from "@/components/dashboard/sidebar";
import { demoDashboard, demoRequest } from "@/lib/demo-data";

export function RequestDetail({ demo = false }: { demo?: boolean }) {
  const [accepted, setAccepted] = useState(false);
  const [declined, setDeclined] = useState(false);

  return (
    <div className="portal-shell">
      <Sidebar companyName={demoDashboard.companyName} initials={demoDashboard.initials} companyStatus="APPROVED" activeRequestCount={demoDashboard.stats.newRequests} unreadNotificationCount={demoDashboard.unreadNotificationCount} demo={demo} />
      <header className="mobile-header"><BrandMark compact /><span>{demoRequest.reference}</span></header>
      <main className="portal-main request-page">
        {demo && <div className="demo-banner"><ShieldCheck size={15} /><span><b>Demonstration request</b> — files and actions below use sample data only.</span></div>}
        <Link href={demo ? "/demo" : "/dashboard/requests"} className="back-link request-back"><ArrowLeft size={14} />Back to requests</Link>
        <div className="request-title-row"><div><div className="request-ref"><span className="status-dot urgent" />{demoRequest.reference}<span className="tag new">New</span></div><h1>{demoRequest.title}</h1><p>{demoRequest.category}</p></div><div className="deadline-box"><Clock3 size={18} /><span>Response deadline<b>{demoRequest.due}</b></span></div></div>
        <div className="request-layout">
          <div className="request-content">
            <section className="panel request-section"><div className="section-title"><MessageSquareText size={18} /><div><p className="eyebrow">Customer brief</p><h2>Requirements</h2></div></div><p className="request-summary">{demoRequest.summary}</p><div className="privacy-note"><LockKeyhole size={17} /><div><b>{demoRequest.requestedBy}</b><p>{demoRequest.customerNotice}</p></div></div></section>
            <section className="panel request-section"><div className="section-title"><FileText size={18} /><div><p className="eyebrow">Bill of requirements</p><h2>Requested items</h2></div></div><div className="items-table">{demoRequest.items.map((item, index) => <div className="item-row" key={item.description}><span className="item-number">{String(index + 1).padStart(2, "0")}</span><div><b>{item.description}</b><p>{item.specification}</p></div><strong>{item.quantity}</strong></div>)}</div></section>
            <section className="panel request-section"><div className="section-title"><Paperclip size={18} /><div><p className="eyebrow">4 files · 6.7 MB</p><h2>Drawings & attachments</h2></div></div><div className="attachment-grid">{demoRequest.attachments.map((file) => <article className="attachment-file demo-attachment" key={file.name} aria-label={`Sample attachment: ${file.name}`}><span>{file.meta.startsWith("PDF") ? <FileText size={19} /> : <FileImage size={19} />}</span><div><b>{file.name}</b><small>{file.type} · {file.meta} · sample only</small></div></article>)}</div></section>
          </div>
          <aside className="request-action-rail">
            <section className="panel action-card"><div className="action-heading"><span><CheckCircle2 size={18} /></span><div><p className="eyebrow">Your response</p><h2>{accepted ? "Prepare quotation" : "Can you quote?"}</h2></div></div>{!accepted && !declined && <><p>Confirm interest to unlock the quotation form. This does not commit you to a price.</p><button className="button button-dark action-primary" onClick={() => setAccepted(true)}><Check size={16} />Accept request</button><button className="decline-button" onClick={() => setDeclined(true)}><X size={15} />Decline</button></>}{declined && <div className="decision-state"><span><X size={17} /></span><b>Request declined</b><p>This sample action is only held in this preview.</p><button onClick={() => setDeclined(false)}>Undo</button></div>}{accepted && <QuotationForm />}</section>
            <section className="panel request-facts"><h3>Request details</h3><Fact icon={<MapPin size={16} />} label="Delivery area" value={demoRequest.delivery} /><Fact icon={<Truck size={16} />} label="Delivery" value="Supply and delivery" /><Fact icon={<CalendarClock size={16} />} label="Required by" value="18 September 2026" /><Fact icon={<PoundSterling size={16} />} label="Budget guidance" value="£15,000–£20,000" /></section>
            <div className="secure-note"><ShieldCheck size={18} /><div><b>Protected enquiry</b><p>Customer contact data is not included in supplier-facing request records.</p></div></div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="fact-row"><span>{icon}</span><div><small>{label}</small><b>{value}</b></div></div>; }

function QuotationForm() {
  const [sent, setSent] = useState(false);
  if (sent) return <div className="decision-state success"><span><Check size={17} /></span><b>Quotation ready</b><p>In the connected portal this submission is stored, audited and sent to Bridge-iT.</p></div>;
  return <form className="quote-mini-form" onSubmit={(event) => { event.preventDefault(); setSent(true); }}><label>Quote price <span className="currency-input"><i>£</i><input type="number" min="1" step="0.01" placeholder="0.00" required /></span></label><label>Lead time <span className="split-input"><input type="number" min="1" placeholder="14" required /><i>days</i></span></label><label>Notes <textarea rows={3} placeholder="Scope, exclusions or terms…" /></label><label className="upload-control"><Paperclip size={15} /><span><b>Attach quotation PDF</b><small>PDF, up to 10 MB</small></span><input type="file" accept="application/pdf" /></label><button className="button button-dark action-primary"><Send size={15} />Submit quotation</button><p className="form-honesty">Preview only: sign in to save and submit a quotation.</p></form>;
}
