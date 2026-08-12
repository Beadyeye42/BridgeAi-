import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  Clock3,
  Factory,
  FileCheck2,
  Hammer,
  House,
  LockKeyhole,
  MapPin,
  MessageCircleMore,
  Paperclip,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  Truck,
  Wrench,
  Zap,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

const metaWhatsAppSource = "https://about.fb.com/news/2026/06/its-time-to-reserve-your-whatsapp-username/";
const publicWhatsAppHref = "https://wa.me/447593103459?text=Hi%20Bridge-iT%2C%20I%20need%20help%20finding%20a%20quote.";

export default function Home() {
  return (
    <main className="home-shell">
      <div className="home-offer-bar">
        <span><Sparkles size={14} /> The AI sourcing network</span>
        <b>Free for people and businesses to use on WhatsApp</b>
        <span>Supplier plans from £14.99 per month</span>
        <Link href="/register">Join the network <ArrowRight size={14} /></Link>
      </div>

      <header className="home-nav">
        <Link href="/" aria-label="Bridge-iT home"><BrandMark /></Link>
        <nav aria-label="Public navigation">
          <Link href="#what-you-can-bridge">What you can Bridge</Link>
          <Link href="#how-it-works">How it works</Link>
          <Link href="/login">Supplier sign in</Link>
          <Link className="button button-dark" href="/register">Join as a supplier <ArrowRight size={15} /></Link>
        </nav>
      </header>

      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="home-kicker"><MessageCircleMore size={15} /> One WhatsApp message. A whole supplier network.</p>
          <h1>Need it?<br /><em>Bridge it.</em></h1>
          <p className="home-intro">Tell Bridge-iT what you need, where you need it and when. Send a message, photo, drawing or document on WhatsApp and our AI turns it into a clear request for approved businesses that can actually help.</p>
          <div className="home-actions">
            <a className="button home-primary" href={publicWhatsAppHref} target="_blank" rel="noreferrer">Bridge a request on WhatsApp <MessageCircleMore size={17} /></a>
            <Link className="button home-secondary" href="/register">Join as a supplier <ArrowRight size={16} /></Link>
          </div>
          <p className="home-action-note"><Check size={14} /> Buyers use Bridge-iT free. No account, app download or long enquiry form.</p>
          <div className="home-trust">
            <span><ShieldCheck size={16} /> Details protected</span>
            <span><Sparkles size={16} /> AI-structured requests</span>
            <span><Target size={16} /> Capability and capacity matched</span>
          </div>
        </div>

        <div className="home-visual" aria-label="A WhatsApp enquiry becoming a supplier opportunity">
          <div className="home-intent-orbit" aria-hidden="true">
            <span>SUPPLY</span><span>HIRE</span><span>MAKE</span><span>MOVE</span><span>SERVICE</span>
          </div>
          <div className="home-phone-card">
            <div className="home-card-heading">
              <span><MessageCircleMore size={19} /></span>
              <div><b>Bridge-iT on WhatsApp</b><small>Consumer, trade or business · now</small></div>
              <i>LIVE</i>
            </div>
            <div className="home-message customer">Can someone move this sofa from Cheltenham to Birmingham on Saturday?</div>
            <div className="home-file-bubble"><Paperclip size={14} /><span><b>sofa-photo.jpg</b><small>Received securely</small></span></div>
            <div className="home-message bridge"><Sparkles size={14} /> Yes. Send the collection and delivery postcodes, and tell me whether you need help carrying it at either end.</div>
            <div className="home-message customer short">GL51 to B24. Help at both ends.</div>
          </div>

          <div className="home-match-card">
            <div className="home-card-heading">
              <span><FileCheck2 size={19} /></span>
              <div><b>New Bridge Request</b><small>Quote pack ready</small></div>
              <i className="ready">READY</i>
            </div>
            <div className="home-match-title"><span>BA-2026-1842 · MOVE</span><b>Sofa transport · Saturday</b></div>
            <dl>
              <div><dt>Route</dt><dd><MapPin size={13} /> GL51 → B24</dd></div>
              <div><dt>Requirements</dt><dd>Two-person carry</dd></div>
              <div><dt>Attachments</dt><dd>1 verified file</dd></div>
              <div><dt>Supplier invitations</dt><dd>Best 3 maximum</dd></div>
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
        <div><strong>3</strong><span><b>matched suppliers maximum</b><small>No first-come, first-served claiming.</small></span></div>
        <div><strong>£0</strong><span><b>winning fees</b><small>Your monthly membership is the full platform fee.</small></span></div>
      </section>

      <section className="home-section home-bridge-map" id="what-you-can-bridge">
        <div className="home-section-heading">
          <p className="eyebrow">One front door to a much bigger network</p>
          <h2>Whatever the request, start with WhatsApp.</h2>
          <p>Bridge-iT recognises what the buyer is trying to achieve and opens the right specialist workflow behind the scenes. Industries stay intelligent without making customers navigate them.</p>
        </div>
        <div className="home-intent-grid">
          <article><span><Boxes size={21} /></span><small>SUPPLY</small><h3>Source products and materials</h3><p>“I need 30 sheets of roofing delivered by Friday.”</p></article>
          <article><span><Wrench size={21} /></span><small>HIRE</small><h3>Find equipment with capacity</h3><p>“I need a 20m cherry picker in Bristol tomorrow.”</p></article>
          <article><span><Factory size={21} /></span><small>MAKE</small><h3>Have something manufactured</h3><p>“Can someone make 100 brackets from this drawing?”</p></article>
          <article><span><Truck size={21} /></span><small>MOVE</small><h3>Move goods, furniture or loads</h3><p>“Can someone collect this sofa on Saturday?”</p></article>
          <article><span><Hammer size={21} /></span><small>SERVICE</small><h3>Find a business to do the work</h3><p>“I need scaffold around this property next week.”</p></article>
        </div>
      </section>

      <section className="home-audiences" aria-label="Who Bridge-iT is for">
        <div className="home-audience-card buyer">
          <span><House size={22} /></span>
          <p className="eyebrow">For buyers</p>
          <h2>People, trades and businesses.</h2>
          <p>Use the same WhatsApp number for a home project, an urgent trade order or a complex business requirement. Explain it naturally and add the evidence suppliers need.</p>
          <ul><li><Check size={15} /> Free to request quotes</li><li><Check size={15} /> No buyer account required</li><li><Check size={15} /> Compare price and lead time privately</li></ul>
          <a href={publicWhatsAppHref} target="_blank" rel="noreferrer">Start on WhatsApp <ArrowRight size={14} /></a>
        </div>
        <div className="home-audience-card supplier">
          <span><BriefcaseBusiness size={22} /></span>
          <p className="eyebrow">For suppliers and service providers</p>
          <h2>Better-fit work, without the public lead scramble.</h2>
          <p>Tell Bridge-iT what you provide, where you operate and what capacity you have. Only matched businesses are invited, and every opportunity arrives as a structured quote pack.</p>
          <ul><li><Check size={15} /> Capability and geography matching</li><li><Check size={15} /> Photos, drawings and documents attached</li><li><Check size={15} /> Maximum five suppliers per request</li></ul>
          <Link href="/register">Join the supplier network <ArrowRight size={14} /></Link>
        </div>
      </section>

      <section className="home-section home-why">
        <div className="home-section-heading">
          <p className="eyebrow">Why conversation wins</p>
          <h2>The power is not another marketplace. It is the conversation.</h2>
          <p>Customers should not need an account, a new app or a long form just to ask for a price. They send the information naturally; Bridge-iT makes it useful to suppliers.</p>
        </div>
        <div className="home-benefit-grid">
          <article><span><Zap size={20} /></span><h3>Less friction for buyers</h3><p>A familiar WhatsApp conversation makes it easy to start an enquiry and continue it from any phone.</p></article>
          <article><span><Paperclip size={20} /></span><h3>The real job stays attached</h3><p>Photos, drawings and PDFs travel with the request, so suppliers can understand what needs pricing.</p></article>
          <article><span><Sparkles size={20} /></span><h3>AI creates the structure</h3><p>Bridge-iT identifies what is needed, where, when, quantity, specification and fulfilment before a request is published.</p></article>
          <article><span><Route size={20} /></span><h3>Relevant suppliers see it</h3><p>Matching uses the products you supply and the distance or postcode areas your business covers.</p></article>
        </div>
      </section>

      <section className="home-transformation">
        <div className="home-transformation-copy">
          <p className="eyebrow">From chat to opportunity</p>
          <h2>Not another lead list.<br />A quote pack you can act on.</h2>
          <p>Bridge-iT is designed to reduce the back-and-forth that slows quoting. Buyer type, intent, requirements and evidence arrive in one secure workspace, and you receive only opportunities that fit the audiences and work your business has chosen.</p>
          <ul>
            <li><CheckCircle2 size={17} /> Clear product and delivery requirements</li>
            <li><CheckCircle2 size={17} /> Customer drawings, photos and PDFs together</li>
            <li><CheckCircle2 size={17} /> Protected contact details until a quote is selected</li>
            <li><CheckCircle2 size={17} /> Price and lead-time comparison through WhatsApp</li>
          </ul>
        </div>
        <div className="home-portal-preview" aria-label="Supplier opportunity preview">
          <div className="home-preview-top"><BrandMark compact /><span>SUPPLIER PORTAL</span><i>NEW</i></div>
          <div className="home-preview-title"><span>Matched opportunity</span><b>Urgent equipment hire</b><small>Selected for your capability, reach and current availability</small></div>
          <div className="home-preview-facts"><span><MapPin size={14} /><b>Bristol</b><small>Inside your service area</small></span><span><Clock3 size={14} /><b>Thursday</b><small>Required date confirmed</small></span><span><Paperclip size={14} /><b>2 files</b><small>Site photos included</small></span></div>
          <div className="home-preview-deadline"><span><i /> Capacity match confirmed</span><b>Respond within two days</b></div>
          <div className="home-preview-button">View full opportunity <ArrowRight size={14} /></div>
        </div>
      </section>

      <section className="home-section home-process" id="how-it-works">
        <div className="home-section-heading compact">
          <p className="eyebrow">From “I need” to “quotes are ready”</p>
          <h2>Four steps. One connected journey.</h2>
        </div>
        <div className="home-flow">
          <div><span>01</span><b>The buyer messages Bridge-iT</b><p>They describe the job and send any supporting photos, drawings or PDFs through WhatsApp.</p></div>
          <div><span>02</span><b>AI understands and qualifies it</b><p>Intent, location, deadline, quantity, specification and files become a structured opportunity.</p></div>
          <div><span>03</span><b>The right businesses are invited</b><p>Up to five eligible suppliers receive it, based on industry, audience, capability, reach and live capacity.</p></div>
          <div><span>04</span><b>The customer selects</b><p>The chosen supplier and customer receive the details needed to move the order forward.</p></div>
        </div>
      </section>

      <section className="home-membership" id="membership">
        <div className="home-membership-copy">
          <p className="eyebrow">Geographic supplier membership</p>
          <h2>Pay for the reach your business actually needs.</h2>
          <p>There is no free-for-all opportunity list. Confirm the products, systems, colours, lead times and live capacity you can genuinely support; Bridge-iT ranks the most suitable suppliers for each request.</p>
          <div className="home-membership-points"><span><Check size={15} /> No introduction fees</span><span><Check size={15} /> No winning fees</span><span><Check size={15} /> Stripe-secured billing</span></div>
        </div>
        <div className="home-plan-stack">
          <div className="home-price-card"><span>HYPERLOCAL PARTNER</span><div><sup>£</sup><strong>14.99</strong><small>per month</small></div><p>Choose a radius from 1–10 miles in eligible industries. Up to 3 live opportunities.</p></div>
          <div className="home-price-card"><span>LOCAL PARTNER</span><div><sup>£</sup><strong>29.99</strong><small>per month</small></div><p>Choose a service and delivery radius from 1–40 miles. Up to 5 live opportunities.</p></div>
          <div className="home-price-card"><span>REGIONAL PARTNER</span><div><sup>£</sup><strong>59.99</strong><small>per month</small></div><p>Choose a radius from 1–100 miles. Up to 10 live opportunities.</p></div>
          <div className="home-price-card"><span>NATIONWIDE PARTNER</span><div><sup>£</sup><strong>89.99</strong><small>per month</small></div><p>Great Britain eligibility with exact capability matching. Up to 20 live opportunities.</p></div>
          <Link className="button button-dark" href="/register">Apply as a supplier <ArrowRight size={15} /></Link><small>Approval is required. Choose the reach that fits your business.</small>
        </div>
      </section>

      <section className="home-footer-cta">
        <div><p className="eyebrow">Demand already starts in conversation</p><h2>Be the business Bridge-iT knows can deliver.</h2><p>Register your company, confirm what you provide, where you operate and when you have capacity. Bridge-iT handles the journey from a natural WhatsApp request to a quote-ready opportunity.</p></div>
        <div><Link className="button button-dark" href="/register">Join Bridge-iT <ArrowRight size={15} /></Link><Link className="text-link" href="/demo">See the portal first</Link></div>
      </section>

      <footer className="home-footer">
        <BrandMark />
        <span>© {new Date().getFullYear()} Ironbridge Group Ltd · Company 16757150 · Registered in England and Wales · 60 Suffolk Road, Cheltenham, GL50 2AQ</span>
        <nav aria-label="Legal and help links"><Link href="/legal/privacy">Privacy</Link><Link href="/legal/terms">Supplier terms</Link><Link href="/legal/customer-terms">Customer terms</Link><Link href="/legal/cancellation">Cancellation</Link><Link href="/legal/cookies">Cookies</Link><Link href="/help">Help</Link></nav>
      </footer>
    </main>
  );
}
