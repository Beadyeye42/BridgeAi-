import Link from "next/link";
import { CheckCircle2, CreditCard, MapPin, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import { CoverageManager } from "@/components/dashboard/management-forms";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { stripeConfigured } from "@/lib/stripe/server";
import { isComplimentaryMembership, isMembershipActive } from "@/lib/billing/pricing";
import { DEFAULT_PLAN_IDS, effectiveMembershipLimits, formatPlanPrice, planTaxLabel, isFreeHyperlocalPlan } from "@/lib/billing/membership-plans";

export const dynamic = "force-dynamic";

export default async function SubscriptionPage() {
  const { session, companyId } = await requireSupplierPage();
  const company = await prisma.supplierCompany.findUniqueOrThrow({ where: { id: companyId }, include: {
    subscription: { include: { membershipPlan: true } },
    coverageAreas: { where: { active: true } },
    collectionLocations: { where: { active: true } },
    categories: { include: { productCategory: { select: { hyperlocalEnabled: true, parent: { select: { hyperlocalEnabled: true } } } } } },
  } });
  const allPlans = await prisma.membershipPlan.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" } });
  const hyperlocalEligible = company.categories.some(({ productCategory }) => productCategory.hyperlocalEnabled || productCategory.parent?.hyperlocalEnabled);
  const plans = allPlans.filter((plan) => plan.tier !== "HYPERLOCAL" || hyperlocalEligible || company.subscription?.membershipPlan?.tier === "HYPERLOCAL");
  const sub = company.subscription;
  const configured = stripeConfigured();
  const active = isMembershipActive(sub);
  const complimentary = isComplimentaryMembership(sub);
  const free = sub?.accessSource === "FREE";
  const currentPlan = sub?.membershipPlan;
  const coveragePlan = active && currentPlan ? currentPlan : allPlans.find((plan) => plan.id === DEFAULT_PLAN_IDS.LOCAL);
  const coverageLimits = coveragePlan ? effectiveMembershipLimits(coveragePlan, company) : null;
  const freeCoverageReady = company.coverageAreas.length > 0 && company.coverageAreas.every((area) => area.type === "DISTANCE" && area.radiusMiles !== null && area.radiusMiles >= 1 && area.radiusMiles <= 2);
  const selectedRadii = company.coverageAreas.filter((area) => area.type === "DISTANCE" && area.radiusMiles !== null).map((area) => area.radiusMiles as number);
  const selectedRadius = selectedRadii.length ? Math.max(...selectedRadii) : null;
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const receivedThisMonth = await prisma.supplierAssignment.count({ where: { supplierCompanyId: companyId, assignedAt: { gte: monthStart } } });
  const displayStatus = active ? "ACTIVE" : sub?.status === "ACTIVE" ? "EXPIRED" : sub?.status ?? "NOT STARTED";

  return <PortalPage {...identity(session, company)} eyebrow="Membership" title="Choose your reach" description={hyperlocalEligible ? "Jobs within 2 miles are free. Choose a paid plan to reach further. No introduction or winning fees." : "Choose how far you want to work. Free 2-mile access is available in eligible service industries; your available plans are shown below."}>
    <section className="panel subscription-detail">
      <span className="large-icon"><CreditCard size={24}/></span>
      <p className="eyebrow">Current access</p>
      <h2>{currentPlan?.name ?? (complimentary ? "Complimentary membership" : "No active membership")}</h2>
      <p className="body-copy">{free ? "Free within 2 miles. No card required and no monthly charge. Upgrade for wider reach." : complimentary ? `Promotional access${sub?.complimentaryReason ? `: ${sub.complimentaryReason}` : ""}. No card details are required and no payment will be taken during this period.` : currentPlan ? `${formatPlanPrice(currentPlan.monthlyPricePence, currentPlan.currency)} ${planTaxLabel(currentPlan)}` : "Select a plan after your supplier account is approved."}</p>
      <span className={`status-pill ${displayStatus.toLowerCase().replaceAll(" ", "-")}`}>{displayStatus}</span>
      <dl>
        <div><dt>Selected coverage</dt><dd>{currentPlan?.nationwideAllowed && company.coverageAreas.some((area) => area.type === "NATIONWIDE") ? "Great Britain" : selectedRadius ? `${selectedRadius} miles` : "Not selected"}</dd></div>
        <div><dt>Plan maximum</dt><dd>{currentPlan?.nationwideAllowed ? "Great Britain" : currentPlan?.maximumRadiusMiles ? `${currentPlan.maximumRadiusMiles} miles` : "—"}</dd></div>
        <div><dt>Live opportunity limit</dt><dd>{currentPlan?.maximumActiveOpportunities ?? "—"}</dd></div>
        <div><dt>Introduction fees</dt><dd>None</dd></div>
        <div><dt>Winning fees</dt><dd>None</dd></div>
        <div><dt>Current period ends</dt><dd>{sub?.currentPeriodEnd?.toLocaleDateString("en-GB") ?? "—"}</dd></div>
      </dl>
      {sub?.cancelAtPeriodEnd && active && <div className="honesty-note">Cancellation is scheduled. Your current access continues until {sub.currentPeriodEnd?.toLocaleDateString("en-GB") ?? "the end of the paid period"}, then new opportunity and quotation access ends.</div>}
      {active && sub?.providerCustomerId && !complimentary && !free && <a className="button button-outline" href="/api/billing/portal">Manage billing or cancel</a>}
    </section>
    <section className="panel form-section" id="choose-coverage">
      <div className="section-heading"><div><p className="eyebrow">1. Choose your area</p><h2>How far will you travel?</h2></div><MapPin size={20}/></div>
      <p className="body-copy">Distances are measured from your registered business base{company.geographicOriginPostcode ? ` in ${company.geographicOriginPostcode}` : ""}. Service and delivery areas can be different.</p>
      {hyperlocalEligible && !freeCoverageReady && <p className="honesty-note">To start free, add a distance area and set every active area to 2 miles or less. Save your changes below, then choose Free Hyperlocal.</p>}
      {coveragePlan && coverageLimits && <details><summary className="text-link">Edit coverage here</summary><CoverageManager
        areas={company.coverageAreas.map((area) => ({ id: area.id, type: area.type, purpose: area.purpose, label: area.label, postcodePrefix: area.postcodePrefix, centrePostcode: area.centrePostcode, radiusMiles: area.radiusMiles }))}
        collections={company.collectionLocations.map((location) => ({ id: location.id, label: location.label, postcode: location.postcode, collectionDays: location.collectionDays, noticeRequired: location.noticeRequired, noticeHours: location.noticeHours }))}
        plan={{ name: coveragePlan.name, tier: coverageLimits.tier, maximumRadiusMiles: coverageLimits.maximumRadiusMiles, maximumServiceRadiusMiles: coverageLimits.maximumServiceRadiusMiles, maximumDeliveryRadiusMiles: coverageLimits.maximumDeliveryRadiusMiles, nationwideAllowed: coverageLimits.nationwideAllowed, maximumActiveOpportunities: coverageLimits.maximumActiveOpportunities, onboardingDefault: !active }}
        companyBasePostcode={company.geographicOriginPostcode ?? company.postcode ?? ""}
      /></details>}
    </section>
    <div className="section-heading"><div><p className="eyebrow">2. Choose your plan</p><h2>{hyperlocalEligible ? "Start free. Upgrade when you need more reach." : "Find a plan for your business"}</h2></div></div>
    <div className="pricing-grid">
      {plans.map((plan) => {
        const selected = currentPlan?.id === plan.id && active;
        return <section className={`panel form-section ${selected ? "selected-plan" : ""}`} key={plan.id}>
          <div className="section-heading"><div><p className="eyebrow">{plan.tier.toLowerCase()} partner</p><h2>{plan.name}</h2></div>{selected ? <CheckCircle2 size={22}/> : <MapPin size={22}/>}</div>
          <h3>{isFreeHyperlocalPlan(plan) ? "Free" : formatPlanPrice(plan.monthlyPricePence, plan.currency)} <small>{isFreeHyperlocalPlan(plan) ? "within 2 miles" : planTaxLabel(plan)}</small></h3>
          <p className="body-copy">{plan.description}</p>
          <div className="entity-list">
            <div className="entity-row"><div><b>{plan.nationwideAllowed ? "Great Britain eligibility" : `Up to ${plan.maximumRadiusMiles} miles`}</b><small>Your actual selected radius may be smaller.</small></div></div>
            <div className="entity-row"><div><b>Up to {plan.maximumActiveOpportunities} live opportunities</b><small>No open public job board.</small></div></div>
            <div className="entity-row"><div><b>Jobs matched to your business</b><small>Your skills, availability and the buyer’s requirements must also match.</small></div></div>
          </div>
          {selected ? <div className="honesty-note">This is your active plan.</div> : plan.tier === "HYPERLOCAL" && !hyperlocalEligible ? <div className="honesty-note">Hyperlocal is not enabled for your selected industries.</div> : company.status !== "APPROVED" ? <div className="honesty-note">Supplier approval is required before checkout.</div> : complimentary && active ? <div className="honesty-note">An administrator can change the tier of active complimentary access.</div> : isFreeHyperlocalPlan(plan) && !freeCoverageReady ? <a className="button button-outline" href="#choose-coverage">Set your 2-mile area first</a> : (configured || isFreeHyperlocalPlan(plan)) ? <CheckoutButton free={isFreeHyperlocalPlan(plan)} endpoint="/api/billing/subscription/checkout" body={{ membershipPlanId: plan.id }}>{isFreeHyperlocalPlan(plan) ? "Start free — no card required" : free ? `Upgrade to ${plan.name}` : active ? `Change to ${plan.name}` : `Choose ${plan.name}`}</CheckoutButton> : <div className="honesty-note">Stripe is not configured in this environment.</div>}
        </section>;
      })}
    </div>
    {active && <p className="body-copy">You received {receivedThisMonth} matched opportunities this month. A wider plan increases your eligible area; it does not guarantee more work.</p>}
    <section className="panel form-section"><div className="section-heading"><div><p className="eyebrow">Secure billing</p><h2>Managed by Stripe</h2></div><ShieldCheck size={20}/></div><p className="body-copy">Bridge-iT never stores card details. Plan prices and geographic limits are controlled centrally and enforced on every opportunity.</p><p className="body-copy">Review the <Link href="/legal/terms">supplier terms</Link> and <Link href="/legal/cancellation">subscription and cancellation policy</Link>. Cancellation normally takes effect at the end of the current paid monthly period.</p></section>
  </PortalPage>;
}
