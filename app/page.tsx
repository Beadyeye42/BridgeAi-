import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, FileText, LockKeyhole, MessageCircleMore, Package, ShieldCheck, Wrench } from "lucide-react";
import { PublicFooter, PublicHeader, WHATSAPP_REQUEST_URL } from "@/components/marketing/site-chrome";

export default function Home() {
  return <div className="home-v2 customer-site">
    <PublicHeader />
    <main id="main-content">
      <section className="v2-hero v2-container customer-hero">
        <div className="v2-hero-copy">
          <p className="v2-kicker">ONE REQUEST. A CLEARER CHOICE.</p>
          <h1>The right business.<br />One message <span>away.</span></h1>
          <p className="v2-intro">Tell us what you need on WhatsApp. We’ll help turn your message, photos or drawings into a clear request for suitable businesses to quote.</p>
          <div className="v2-actions">
            <a className="v2-button v2-dark" href={WHATSAPP_REQUEST_URL} target="_blank" rel="noreferrer">Get quotes on WhatsApp <MessageCircleMore size={19} /></a>
            <Link className="v2-button v2-outline" href="/buyer/login">View my requests <ArrowUpRight size={18} /></Link>
          </div>
          <p className="v2-small-note"><Check size={16} /> Free to request quotes. No new app to download.</p>
          <div className="v2-hero-assurances"><span><LockKeyhole size={17} /> Contact details protected while quoting</span><span><Check size={17} /> You decide whether to go ahead</span></div>
        </div>
        <div className="request-example" aria-label="Illustrative request and quote comparison, not live offers">
          <div className="request-example-heading"><span><MessageCircleMore size={20} /> Your request</span><small>EXAMPLE</small></div>
          <p className="request-example-message">“I need five white uPVC windows, supply only, delivered to Cheltenham.”</p>
          <div className="request-example-summary"><FileText size={18} /><div><b>Get the details right first.</b><p>Add your sizes and drawings. Check the summary before it goes to suppliers.</p></div></div>
          <div className="request-example-compare"><span>When quotes arrive</span><h2>Compare more than the price.</h2>
            <dl><div><dt>Specification</dt><dd>What is included?</dd></div><div><dt>Total price</dt><dd>Tax and delivery clear?</dd></div><div><dt>Lead time</dt><dd>Does it fit your project?</dd></div></dl>
            <div className="request-example-question"><MessageCircleMore size={18} /><span>Ask a question before you choose.</span></div>
          </div>
          <p className="request-example-note">Illustration only. Responses depend on suitable suppliers and their availability.</p>
        </div>
      </section>
      <section className="v2-principles v2-container" aria-label="Why use Bridge-iT?">
        <div><span>01</span><b>Explain it once.</b><p>Your requirements stay with your request.</p></div>
        <div><span>02</span><b>Keep the choice relevant.</b><p>Up to five suitable suppliers can quote.</p></div>
        <div><span>03</span><b>Choose with clarity.</b><p>Compare offers and ask about the details.</p></div>
      </section>
      <section className="v2-container v2-section" id="what-you-need">
        <div className="v2-section-head"><div><p className="v2-kicker">START WITH WHAT YOU NEED</p><h2>A product to source.<br />A job to get done.</h2></div><p>Tell us what, where and when. Matching depends on the businesses serving your category and area.</p></div>
        <div className="customer-needs">
          <article><Package size={27} /><h3>Products & materials</h3><p>Send the specification, quantity and delivery requirements. Photos and drawings help suppliers understand what to price.</p><span>For example: windows for a building project.</span></article>
          <article><Wrench size={27} /><h3>Services & project work</h3><p>Describe the work, location and timing. Tell us whether a visit or a final survey may be needed before a firm quote.</p><span>For example: a repair or a garden project.</span></article>
        </div>
        <p className="public-note">We don’t guarantee five quotes or availability everywhere. A request is matched against supplier capability, coverage and current availability.</p>
      </section>
      <section className="v2-how" id="how-it-works"><div className="v2-container">
        <div className="v2-section-head"><div><p className="v2-kicker">FROM FIRST MESSAGE TO NEXT STEP</p><h2>Less chasing.<br />More understanding.</h2></div><a className="v2-text-link" href={WHATSAPP_REQUEST_URL} target="_blank" rel="noreferrer">Start your request <ArrowUpRight size={18} /></a></div>
        <div className="v2-steps">
          <article><span>01 <MessageCircleMore size={22} /></span><h3>Tell us. Then check it.</h3><p>Start on WhatsApp and answer any follow-up questions. Review and correct the request summary before confirming it.</p></article>
          <article><span>02 <FileText size={22} /></span><h3>Compare the responses.</h3><p>Suitable suppliers are invited to quote. Return to the Buyer Hub to view your requests, compare offers and ask suppliers questions.</p></article>
          <article><span>03 <Check size={22} /></span><h3>Choose your next step.</h3><p>Select a proposal to exchange contact details. Agree the final specification, price and any survey or booking directly with the supplier.</p></article>
        </div>
        <p className="public-note">Selecting a proposal expresses your preference. It does not necessarily confirm an order or booking. <Link href="/legal/customer-terms">Read the customer terms.</Link></p>
      </div></section>
      <section className="v2-container v2-section" id="your-confidence">
        <div className="v2-section-head"><div><p className="v2-kicker">KNOW WHERE YOU STAND</p><h2>Your request.<br />Your decision.</h2></div><p>Understand what Bridge-iT does, what a supplier offers and where to get help.</p></div>
        <div className="v2-benefits customer-trust">
          <article className="v2-benefit"><ShieldCheck size={27} /><h3>What approval means</h3><p>Suppliers need administrator approval to participate. This is not a guarantee of their work. Check the business, relevant credentials and quotation before agreeing.</p><Link href="/help#supplier-approval">Understand supplier approval <ArrowRight size={16} /></Link></article>
          <article className="v2-benefit"><LockKeyhole size={27} /><h3>Control over your details</h3><p>Your contact details are withheld while suppliers quote. Selecting a proposal allows the chosen supplier and you to exchange the details needed to proceed.</p><Link href="/legal/privacy">How your information is used <ArrowRight size={16} /></Link></article>
          <article className="v2-benefit"><MessageCircleMore size={27} /><h3>A clear route to help</h3><p>Need help with a request, access or a complaint? Find our support contact and tell us your request reference so we can look into it.</p><Link href="/help">Get help with Bridge-iT <ArrowRight size={16} /></Link></article>
        </div>
      </section>
      <section className="v2-container v2-buyer-banner"><div><p className="v2-kicker">DO YOU SUPPLY PRODUCTS OR SERVICES?</p><h2>Bring your business<br />to the right requests.</h2><p>See how matching, quoting and membership work before you join.</p></div><Link className="v2-button v2-dark" href="/suppliers">Explore Bridge-iT for suppliers <ArrowUpRight size={18} /></Link></section>
    </main>
    <PublicFooter />
  </div>;
}
