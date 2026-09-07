import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, ChevronRight, Leaf, MapPin, MessageCircleMore, ShieldCheck, Sparkles, Wrench, CalendarDays, MoveRight, LockKeyhole } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

const whatsapp = "https://wa.me/447593103459?text=Hi%20Bridge-iT%2C%20I%20need%20help%20finding%20a%20quote.";

export default function Home() {
  return <main className="home-v2">
    <a className="v2-skip" href="#main-content">Skip to content</a>
    <header className="v2-nav">
      <Link href="/" aria-label="Bridge-iT home"><BrandMark /></Link>
      <nav aria-label="Public navigation"><a href="#how-it-works">How it works</a><a href="#for-suppliers">For businesses</a><a href="#membership">Pricing</a></nav>
      <div className="v2-nav-actions"><Link href="/login">Sign in</Link><Link className="v2-button v2-dark" href="/register">Find local work <ArrowUpRight size={16}/></Link></div>
    </header>

    <section className="v2-hero v2-container" id="main-content">
      <div className="v2-hero-copy">
        <p className="v2-kicker"><span/> GOOD WORK. CLOSER TO HOME.</p>
        <h1>Your next job.<br/>A little <span>closer.</span></h1>
        <p className="v2-intro">A gap in your diary. A job around the corner. Bridge-iT connects local service businesses with people who need their skills.</p>
        <div className="v2-actions"><Link className="v2-button v2-dark" href="/register">Find work near you <ArrowUpRight size={18}/></Link><a className="v2-button v2-outline" href={whatsapp} target="_blank" rel="noreferrer">I need a local service <MessageCircleMore size={18}/></a></div>
        <p className="v2-small-note"><Check size={15}/> Free within 2 miles for eligible service businesses.</p>
        <div className="v2-hero-assurances"><span><ShieldCheck size={16}/> Approved suppliers</span><span><MapPin size={16}/> Relevant local requests</span><span><Check size={16}/> No winning fees</span></div>
      </div>
      <div className="v2-neighbourhood" aria-label="Illustration of local job matching. Examples, not live requests.">
        <div className="v2-map-grid" aria-hidden="true"/><div className="v2-radius v2-radius-outer" aria-hidden="true"/><div className="v2-radius v2-radius-inner" aria-hidden="true"/>
        <span className="v2-map-caption"><MapPin size={14}/> Your local area</span>
        <div className="v2-base"><span><Wrench size={25}/></span><b>Your business</b><small>Good work starts nearby</small></div>
        <div className="v2-job v2-job-garden"><span className="v2-job-icon"><Leaf size={20}/></span><div><small>GARDEN & OUTDOOR</small><b>A garden ready for a fresh start</b><p><MapPin size={12}/> 1.2 miles away <i/> This week</p></div><ArrowUpRight size={17}/></div>
        <div className="v2-job v2-job-repair"><span className="v2-job-icon coral"><Wrench size={20}/></span><div><small>PLUMBING & REPAIRS</small><b>A dripping tap. Your next small job.</b><p><MapPin size={12}/> 0.8 miles away <i/> Flexible</p></div></div>
        <div className="v2-availability"><CalendarDays size={18}/><span>Your skills.<br/><b>Your availability.</b></span><Check size={16}/></div>
        <span className="v2-example-label">ILLUSTRATION · NOT LIVE REQUESTS</span>
      </div>
    </section>

    <section className="v2-principles v2-container" aria-label="A better way to find local work"><div><span>01</span><b>Less chasing.</b><p>Clearer requests, in one place.</p></div><div><span>02</span><b>A better fit.</b><p>Matched to your services and area.</p></div><div><span>03</span><b>You stay in control.</b><p>Choose which jobs to quote.</p></div></section>

    <section className="v2-container v2-section" id="for-suppliers">
      <div className="v2-section-head"><div><p className="v2-kicker">BUILT FOR THE BUSINESS BEHIND THE JOB</p><h2>More of the work you want.<br/>Less of the runaround.</h2></div><p>You know your trade. Let Bridge-iT help you find the requests worth your time.</p></div>
      <div className="v2-benefits">
        <article className="v2-benefit featured"><span className="v2-feature-icon"><CalendarDays size={24}/></span><h3>Make room for<br/>the right work.</h3><p>Keep your availability and capacity up to date. Receive requests that match what you do and where you work.</p><Link href="/register">Set up your business <ArrowUpRight size={16}/></Link><div className="v2-week" aria-hidden="true"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><i/><i/><i className="open">Your next job?</i><i/></div></article>
        <article className="v2-benefit"><span className="v2-feature-icon"><MessageCircleMore size={24}/></span><h3>Understand the job.<br/>Then decide.</h3><p>Review the buyer’s requirements, location, timing and available photos before choosing whether to quote.</p><span className="v2-feature-foot"><Check size={15}/> Relevant details, together</span></article>
        <article className="v2-benefit"><span className="v2-feature-icon"><LockKeyhole size={24}/></span><h3>Your quote.<br/>Your business.</h3><p>Quote privately through your workspace. A shortlist of up to five eligible suppliers keeps each request focused.</p><span className="v2-feature-foot"><ShieldCheck size={15}/> No public bidding board</span></article>
      </div>
    </section>

    <section className="v2-how" id="how-it-works"><div className="v2-container"><div className="v2-section-head"><div><p className="v2-kicker">SIMPLE FROM THE FIRST MESSAGE</p><h2>From “can you help?”<br/>to “let’s get it done.”</h2></div><a className="v2-text-link" href={whatsapp} target="_blank" rel="noreferrer">Start a request <ArrowUpRight size={18}/></a></div>
      <div className="v2-steps"><article><span>01 <MessageCircleMore size={21}/></span><h3>Tell us what’s needed.</h3><p>The buyer starts on WhatsApp with the job, location and timing. Bridge-iT asks for the details needed to match it.</p></article><article><span>02 <Sparkles size={21}/></span><h3>Connect with a good fit.</h3><p>Suitable businesses receive a structured request. Each supplier decides whether to respond with a quote.</p></article><article><span>03 <Check size={21}/></span><h3>Choose. Agree. Get started.</h3><p>The buyer selects a quote. Contact details are released so both sides can agree the final scope and arrangements.</p></article></div>
    </div></section>

    <section className="v2-container v2-section v2-membership" id="membership"><div><p className="v2-kicker">START SMALL. STAY LOCAL.</p><h2>Find your feet.<br/>Then find your reach.</h2><p>Start with free access close to your business. Choose a wider paid area when it makes sense for you.</p><ul><li><Check size={17}/> No introduction fees</li><li><Check size={17}/> No winning fees</li><li><Check size={17}/> You choose which requests to quote</li></ul><p className="v2-price-disclaimer">Approval and industry eligibility apply. Matching depends on demand, your services and availability. Membership does not guarantee work.</p></div>
      <div className="v2-price-panel"><div className="v2-plan-label"><span>FREE HYPERLOCAL</span><MapPin size={20}/></div><div className="v2-price">£0<small>/ month</small></div><h3>Your neighbourhood. Within 2 miles.</h3><p>No card required. Available to approved businesses in eligible service industries.</p><Link className="v2-button v2-dark" href="/register">Apply for free local access <ArrowRight size={17}/></Link><div className="v2-paid"><div><b>Need a wider area?</b><small>Paid plans start at £14.99/month for up to 10 miles.</small></div><Link href="/dashboard/subscription" aria-label="Compare membership plans"><ChevronRight size={22}/></Link></div></div>
    </section>

    <section className="v2-container v2-buyer-banner"><div className="v2-buyer-symbol"><MessageCircleMore size={35}/></div><div><p className="v2-kicker">SOMETHING NEEDS DOING?</p><h2>A good local business.<br/>One message away.</h2><p>Tell us what you need on WhatsApp. Requesting quotes is free.</p></div><a className="v2-button v2-dark" href={whatsapp} target="_blank" rel="noreferrer">Start on WhatsApp <MoveRight size={19}/></a></section>
    <footer className="v2-footer v2-container"><div><Link href="/" aria-label="Bridge-iT home"><BrandMark/></Link><p>Good work. Closer to home.</p></div><nav aria-label="Footer navigation"><Link href="/demo">Explore the supplier workspace</Link><Link href="/help">Help & support</Link><Link href="/legal/terms">Supplier terms</Link><Link href="/legal/customer-terms">Customer terms</Link><Link href="/legal/privacy">Privacy</Link><Link href="/legal/cookies">Cookies</Link><Link href="/legal/cancellation">Cancellation</Link></nav><small>Bridge-iT · Ironbridge Group Ltd</small></footer>
  </main>;
}
