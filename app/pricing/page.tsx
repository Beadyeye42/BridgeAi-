import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Check, MapPin } from "lucide-react";
import { PublicFooter, PublicHeader } from "@/components/marketing/site-chrome";
import { getPublicMembershipPlans } from "@/lib/db";
import { formatPlanPrice, isFreeHyperlocalPlan } from "@/lib/billing/membership-plans";

export const metadata: Metadata = { title: "Supplier pricing", description: "Compare Bridge-iT supplier membership prices and coverage before registering. No introduction or winning fees." };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const plans = await getPublicMembershipPlans().catch(() => {
    console.error("Public membership pricing could not be loaded.");
    return null;
  });
  return <div className="home-v2 customer-site"><PublicHeader supplier />
    <main id="main-content" className="v2-container public-content">
      <div className="public-page-heading"><p className="v2-kicker">SUPPLIER MEMBERSHIP</p><h1>Know the cost.<br />Choose your reach.</h1><p>Compare membership before you create an account. Your plan sets your eligible coverage and live opportunity limit. You decide which requests to quote.</p></div>
      <div className="public-pricing-assurances"><span><Check size={18} /> No introduction fees</span><span><Check size={18} /> No winning fees</span><span><Check size={18} /> Customers request quotes free</span></div>
      {plans && plans.length > 0 ? <div className="public-pricing-grid">{plans.map((plan) => <article className={`public-plan${isFreeHyperlocalPlan(plan) ? " public-plan-free" : ""}`} key={plan.id}>
        <div className="public-plan-heading"><h2>{plan.name}</h2><MapPin size={21} /></div>
        <p className="public-plan-price">{formatPlanPrice(plan.monthlyPricePence, plan.currency)}<span>/month</span></p>
        <p>{plan.description}</p>
        <ul><li>{plan.nationwideAllowed ? "Great Britain coverage eligibility" : `Up to ${plan.maximumRadiusMiles} miles from your business base`}</li><li>Standard live opportunity limit: {plan.maximumActiveOpportunities}</li><li>{plan.tier === "HYPERLOCAL" ? "Eligible service industries only" : "Matching by category, coverage and capability"}</li><li>{isFreeHyperlocalPlan(plan) ? "No card required" : "Monthly membership"}</li></ul>
        {plan.taxEnabled && <p className="public-note">Applicable tax is calculated at checkout.</p>}
        <Link className="v2-button v2-dark" href="/register">{isFreeHyperlocalPlan(plan) ? "Apply for free access" : "Apply as a supplier"} <ArrowUpRight size={17} /></Link>
      </article>)}</div> : <div className="public-support-card" role="status"><h2>We can’t display current prices right now.</h2><p>Please try again shortly, or contact us for membership information. You can still explore how Bridge-iT works.</p><Link className="v2-button v2-outline" href="/help">Contact Bridge-iT</Link></div>}
      <p className="public-note">Supplier approval is required. Free Hyperlocal access requires an eligible service industry and active coverage within 2 miles. Paid coverage does not guarantee enquiries, quotations or work. Live opportunity limits are standard capacity limits, not promised lead volumes; additional relevant opportunities may be offered depending on local availability.</p>
      <div className="public-faq"><h2>Before you join</h2>
        <details><summary>Does a wider plan put me first?</summary><p>A wider plan increases the area in which you can be considered. Matching still depends on the request, your capability, availability and coverage.</p></details>
        <details><summary>Can I cancel a paid membership?</summary><p>You can manage billing and cancel through your supplier account. Cancellation normally takes effect at the end of the current paid monthly period. See the <Link href="/legal/cancellation">cancellation policy</Link>.</p></details>
        <details><summary>Can delivery and service coverage be different?</summary><p>Yes. Configure your delivery and service areas within your membership limits. Products and work are matched to the relevant coverage.</p></details>
      </div>
      <p className="public-note">Already a supplier? <Link href="/dashboard/subscription">Manage your membership</Link>. Review the <Link href="/legal/terms">supplier terms</Link> before subscribing.</p>
    </main><PublicFooter /></div>;
}
