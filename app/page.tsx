import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  FileCheck2,
  FileText,
  LockKeyhole,
  MapPin,
  MessageCircleMore,
  Paperclip,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound,
  Zap,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

const metaWhatsAppSource = "https://about.fb.com/news/2026/06/its-time-to-reserve-your-whatsapp-username/";

export default function Home() {
  return (
    <main className="home-shell">
      <div className="home-offer-bar">
        <span><Sparkles size={14} /> Founding supplier offer</span>
        <b>£29.99 + VAT per month for six months</b>
        <span>Only 100 approved places</span>
        <Link href="/register">Claim your place <ArrowRight size={14} /></Link>
      </div>

      <header className="home-nav">
        <Link href="/" aria-label="Bridge AI home"><BrandMark /></Link>
        <nav aria-label="Public navigation">
          <Link href="#how-it-works">How it works</Link>
          <Link href="#membership">Membership</Link>
          <Link href="/login">Supplier sign in</Link>
          <Link className="button button-dark" href="/register">Join Bridge AI <ArrowRight size={15} /></Link>
        </nav>
      </header>

      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="home-kicker"><MessageCircleMore size={15} /> Built around the way customers already buy</p>
          <h1>Your next trade customer is already on <em>WhatsApp.</em></h1>
          <p className="home-intro">Bridge AI turns customer messages, photos, drawings and PDFs into clear quote opportunities—then matches each job with approved suppliers for the right product and delivery area.</p>
          <div className="home-actions">
            <Link className="button button-dark home-primary" href="/register">Claim a founding supplier place <ArrowRight size={16} /></Link>
            <Link className="button button-outline home-secondary" href="/demo">Explore the supplier portal</Link>
          </div>
          <p className="home-action-note"><Check size={14} /> Browse safe opportunity summaries before subscribing. No introduction or winning fees.</p>
          <div className="home-trust">
            <span><ShieldCheck size={16} /> Customer details protected</span>
            <span><Target size={16} /> Product and coverage matching</span>
            <span><UsersRound size={16} /> Maximum five suppliers per job</span>
          </div>
        </div>

        <div className="home-visual" aria-label="A WhatsApp enquiry becoming a supplier opportunity">
          <div className="home-phone-card">
            <div className="home-card-heading">
              <span><MessageCircleMore size={19} /></span>
              <div><b>WhatsApp enquiry</b><small>Trade buyer · now</small></div>
              <i>LIVE</i>
            </div>
            <div className="home-message customer">Morning, I need five anthracite uPVC windows and a composite back door. Can you get me prices?</div>
            <div className="home-file-bubble"><Paperclip size={14} /><span><b>Site drawings.pdf</b><small>4 pages · received securely</small></span></div>
            <div className="home-message bridge"><Sparkles size={14} /> Absolutely. What is the delivery postcode?</div>
            <div className="home-message customer short">GL52 6TD</div>
          </div>

          <div className="home-match-card">
            <div className="home-card-heading">
              <span><FileCheck2 size={19} /></span>
              <div><b>New matched opportunity</b><small>Quote pack ready</small></div>
              <i className="ready">READY</i>
            </div>
            <div className="home-match-title"><span>BA-2026-1842</span><b>Windows & composite door</b></div>
            <dl>
              <div><dt>Delivery area</dt><dd><MapPin size={13} /> GL52</dd></div>
              <div><dt>Requirements</dt><dd>6 items</dd></div>
              <div><dt>Attachments</dt><dd>1 verified file</dd></div>
              <div><dt>Supplier places</dt><dd>5 maximum</dd></div>
            </dl>
            <div className="home-match-action"><span><LockKeyhole size={13} /> Contact details protected</span><b>View opportunity <ArrowRight size={13} /></b></div>
          </div>
        </div>
      </section>

      <section className="home-proof" aria-label="Why WhatsApp matters to suppliers">
        <div className="home-proof-lead">
          <strong>3B+</strong>
          <span><b>people use WhatsApp</b><small>Messaging is already a daily customer habit.</small></span>
          <a href={metaWhatsAppSource} target="_blank" rel="noreferrer">Source: Meta, June 2026</a>
        </div>
        <div><strong>5</strong><span><b>suppliers maximum</b><small>Every job has a controlled quote limit.</small></span></div>
        <div><strong>£0</strong><span><b>winning fees</b><small>Your monthly membership is the full platform fee.</small></span></div>
      </section>

      <section className="home-section home-why">
        <div className="home-section-heading">
          <p className="eyebrow">Why conversation wins</p>
          <h2>Meet customers where the job already starts.</h2>
          <p>Customers should not need an account, a new app or a long form just to ask for a price. They send the information naturally; Bridge AI makes it useful to suppliers.</p>
        </div>
        <div className="home-benefit-grid">
          <article><span><Zap size={20} /></span><h3>Less friction for buyers</h3><p>A familiar WhatsApp conversation makes it easy to start an enquiry and continue it from any phone.</p></article>
          <article><span><Paperclip size={20} /></span><h3>The real job stays attached</h3><p>Photos, drawings and PDFs travel with the request, so suppliers can understand what needs pricing.</p></article>
          <article><span><Sparkles size={20} /></span><h3>AI creates the structure</h3><p>Bridge AI identifies the product, delivery area and requirements before a quote opportunity is published.</p></article>
          <article><span><Route size={20} /></span><h3>Relevant suppliers see it</h3><p>Matching uses the products you supply and the distance or postcode areas your business covers.</p></article>
        </div>
      </section>

      <section className="home-transformation">
        <div className="home-transformation-copy">
          <p className="eyebrow">From chat to opportunity</p>
          <h2>Not another lead list.<br />A quote pack you can act on.</h2>
          <p>Bridge AI is designed to reduce the back-and-forth that slows trade quoting. You receive the information in one secure workspace and choose which opportunities fit your business.</p>
          <ul>
            <li><CheckCircle2 size={17} /> Clear product and delivery requirements</li>
            <li><CheckCircle2 size={17} /> Customer drawings, photos and PDFs together</li>
            <li><CheckCircle2 size={17} /> Protected contact details until a quote is selected</li>
            <li><CheckCircle2 size={17} /> Price and lead-time comparison through WhatsApp</li>
          </ul>
        </div>
        <div className="home-portal-preview" aria-label="Supplier opportunity preview">
          <div className="home-preview-top"><BrandMark compact /><span>SUPPLIER PORTAL</span><i>NEW</i></div>
          <div className="home-preview-title"><span>Quote opportunity</span><b>6 uPVC windows & composite door</b><small>Matched to your products and coverage</small></div>
          <div className="home-preview-facts"><span><MapPin size={14} /><b>GL52 area</b><small>38 miles away</small></span><span><FileText size={14} /><b>6 items</b><small>Specifications included</small></span><span><Paperclip size={14} /><b>1 file</b><small>Security checked</small></span></div>
          <div className="home-preview-deadline"><span><i /> 3 of 5 places available</span><b>Respond by 4:30pm tomorrow</b></div>
          <div className="home-preview-button">View full opportunity <ArrowRight size={14} /></div>
        </div>
      </section>

      <section className="home-section home-process" id="how-it-works">
        <div className="home-section-heading compact">
          <p className="eyebrow">A better route to the right order</p>
          <h2>Four steps. One connected journey.</h2>
        </div>
        <div className="home-flow">
          <div><span>01</span><b>The buyer messages Bridge AI</b><p>They describe the job and send any supporting photos, drawings or PDFs through WhatsApp.</p></div>
          <div><span>02</span><b>AI prepares the quote request</b><p>Product, delivery area, specifications and files become a structured opportunity.</p></div>
          <div><span>03</span><b>Matched suppliers choose to quote</b><p>Up to five relevant subscribed suppliers can submit a price and lead time.</p></div>
          <div><span>04</span><b>The customer selects</b><p>The chosen supplier and customer receive the details needed to move the order forward.</p></div>
        </div>
      </section>

      <section className="home-membership" id="membership">
        <div className="home-membership-copy">
          <p className="eyebrow">Founding supplier membership</p>
          <h2>Join early. Build your advantage.</h2>
          <p>Bridge AI is opening the network to its first 100 approved suppliers. Set your products and coverage, browse suitable opportunities and subscribe when you are ready to quote.</p>
          <div className="home-membership-points"><span><Check size={15} /> No introduction fees</span><span><Check size={15} /> No winning fees</span><span><Check size={15} /> Stripe-secured billing</span></div>
        </div>
        <div className="home-price-card">
          <span>FIRST SIX MONTHS</span>
          <div><sup>£</sup><strong>29.99</strong><small>+ VAT<br />per month</small></div>
          <p>Then £49.99 + VAT per month.</p>
          <Link className="button" href="/register">Apply for a founding place <ArrowRight size={15} /></Link>
          <small>Membership is available only after supplier approval.</small>
        </div>
      </section>

      <section className="home-footer-cta">
        <div><p className="eyebrow">Your next opportunity could start with a message</p><h2>Be one of the suppliers ready to answer.</h2><p>Register your company, choose the products you supply and tell us where you deliver. Bridge AI will handle the journey from customer conversation to quote-ready opportunity.</p></div>
        <div><Link className="button button-dark" href="/register">Join Bridge AI <ArrowRight size={15} /></Link><Link className="text-link" href="/demo">See the portal first</Link></div>
      </section>

      <footer className="home-footer"><BrandMark /><span>© {new Date().getFullYear()} Ironbridge Group Ltd</span><nav><Link href="/legal/privacy">Privacy</Link><Link href="/legal/terms">Terms</Link><Link href="/help">Help</Link></nav></footer>
    </main>
  );
}
