import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  MapPin,
  MessageCircleMore,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export default function Home() {
  return (
    <main className="home-shell">
      <header className="home-nav">
        <Link href="/" aria-label="Bridge AI home"><BrandMark /></Link>
        <nav aria-label="Public navigation">
          <Link href="/demo">View demonstration</Link>
          <Link href="/login">Supplier sign in</Link>
          <Link className="button button-dark" href="/register">Join as a supplier <ArrowRight size={15} /></Link>
        </nav>
      </header>

      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="home-kicker"><Sparkles size={15} /> AI-powered trade enquiries through WhatsApp</p>
          <h1>Better enquiries.<br /><em>Better supplier matches.</em></h1>
          <p className="home-intro">Bridge AI turns customer WhatsApp messages, photos, drawings and PDFs into clear quote requests—then connects them with approved suppliers that cover the right product and area.</p>
          <div className="home-actions">
            <Link className="button button-dark home-primary" href="/register">Register your company <ArrowRight size={16} /></Link>
            <Link className="button button-outline home-secondary" href="/login">Supplier sign in</Link>
          </div>
          <div className="home-trust">
            <span><ShieldCheck size={16} /> Customer details protected</span>
            <span><CheckCircle2 size={16} /> Approved suppliers only</span>
            <span><UsersRound size={16} /> Owned by Ironbridge Group Ltd</span>
          </div>
        </div>

        <div className="home-visual" aria-label="How Bridge AI structures a customer enquiry">
          <div className="home-chat-card">
            <div className="home-card-heading"><span><MessageCircleMore size={18} /></span><div><b>Customer enquiry</b><small>Received securely through WhatsApp</small></div><i>LIVE</i></div>
            <div className="home-message customer">I need five uPVC windows and a back door. I’ve attached the drawings.</div>
            <div className="home-message bridge"><Sparkles size={14} /> Thanks—what is the delivery postcode?</div>
            <div className="home-message customer short">GL52 6TD</div>
          </div>
          <div className="home-quote-card">
            <div className="home-card-heading"><span><FileText size={18} /></span><div><b>Structured quote request</b><small>Ready for suitable suppliers</small></div><i className="ready">READY</i></div>
            <dl>
              <div><dt>Product</dt><dd>uPVC windows & back door</dd></div>
              <div><dt>Delivery</dt><dd><MapPin size={13} /> GL52 area</dd></div>
              <div><dt>Attachments</dt><dd>Drawings received</dd></div>
              <div><dt>Response window</dt><dd><Clock3 size={13} /> Business hours protected</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <section className="home-flow" aria-label="How Bridge AI works">
        <div><span>01</span><b>Customer asks on WhatsApp</b><p>No website account or complicated forms.</p></div>
        <div><span>02</span><b>Bridge AI structures the request</b><p>Requirements and attachments stay together.</p></div>
        <div><span>03</span><b>Suitable suppliers quote</b><p>Matching uses products and delivery coverage.</p></div>
        <div><span>04</span><b>Customer compares clearly</b><p>Up to five prices and lead times, without unnecessary contact sharing.</p></div>
      </section>

      <section className="home-footer-cta">
        <div><p className="eyebrow">Supplier portal</p><h2>Ready to receive better-matched opportunities?</h2><p>Set up your company, products and coverage area, then manage every quotation in one secure workspace.</p></div>
        <div><Link className="button button-dark" href="/register">Register as a supplier <ArrowRight size={15} /></Link><Link className="text-link" href="/demo">View the demonstration</Link></div>
      </section>

      <footer className="home-footer"><BrandMark /><span>© {new Date().getFullYear()} Ironbridge Group Ltd</span><nav><Link href="/legal/privacy">Privacy</Link><Link href="/legal/terms">Terms</Link><Link href="/help">Help</Link></nav></footer>
    </main>
  );
}
