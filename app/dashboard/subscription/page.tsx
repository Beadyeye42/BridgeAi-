import Link from "next/link";
import { CheckCircle2, CreditCard, MapPin, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { stripeConfigured } from "@/lib/stripe/server";
import { isComplimentaryMembership, isMembershipActive } from "@/lib/billing/pricing";
import { effectiveMembershipLimits, formatPlanPrice, planTaxLabel } from "@/lib/billing/membership-plans";

export const dynamic = "force-dynamic";

export default async function SubscriptionPage() {
  const { session, companyId } = await requireSupplierPage();
  const company = await prisma.supplierCompany.findUniqueOrThrow({ where: { id: companyId }, include: {
    subscription: { include: { membershipPlan: true } },
    coverageAreas: { where: { active: true }, select: { type: true, purpose: true, radiusMiles: true } },
    categories: { include: { productCategory: { select: { hyperlocalEnabled: true, parent: { select: { hyperlocalEnabled: true } } } } } },
  } });
  const allPlans = await prisma.membershipPlan.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" } });
  const hyperlocalEligible = company.categories.some(({ productCategory }) => productCategory.hyperlocalEnabled || productCategory.parent?.hyperlocalEnabled);
  const plans = allPlans.filter((plan) => plan.tier !== "HYPERLOCAL" || hyperlocalEligible || company.subscription?.membershipPlan?.tier === "HYPERLOCAL");
  const sub = company.subscription;
  const configured = stripeConfigured();
  const active = isMembershipActive(sub);
  const complimentary = isComplimentaryMembership(sub);
  const currentPlan = sub?.membershipPlan;
  const currentLimits = currentPlan ? effectiveMembershipLimits(currentPlan, company) : null;
  const selectedRadii = company.coverageAreas.filter((area) => area.type === "DISTANCE" && area.radiusMiles !== null).map((area) => area.radiusMiles as number);
  const selectedRadius = selectedRadii.length ? Math.max(...selectedRadii) : null;
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const receivedThisMonth = await prisma.supplierAssignment.count({ where: { supplierCompanyId: companyId, assignedAt: { gte: monthStart } } });
  const rejectedOutsideRadius = currentLimits?.maximumRadiusMiles
    ? await prisma.supplierMatchDecision.count({ where: { supplierCompanyId: companyId, decidedAt: { gte: monthStart }, outcome: "REJECTED", distanceMiles: { gt: currentLimits.maximumRadiusMiles } } })
    : 0;
  const displayStatus = active ? "ACTIVE" : sub?.status === "ACTIVE" ? "EXPIRED" : sub?.status ?? "NOT STARTED";

  return <PortalPage {...identity(session, company)} eyebrow="Membership" title="Choose your reach" description="Your plan sets the largest area you may choose and how many live opportunities you can hold. Exact product, capability, capacity and deadline matching still applies on every tier.">
    <section className="panel subscription-detail">
      <span className="large-icon"><CreditCard size={24}/></span>
      <p className="eyebrow">Current access</p>
      <h2>{currentPlan?.name ?? (complimentary ? "Complimentary membership" : "No active membership")}</h2>
      <p className="body-copy">{complimentary ? `Promotional access${sub?.complimentaryReason ? `: ${sub.complimentaryReason}` : ""}. No card details are required and no payment will be taken during this period.` : currentPlan ? `${formatPlanPrice(currentPlan.monthlyPricePence, currentPlan.currency)} ${planTaxLabel(currentPlan)}` : "Select a plan after your supplier account is approved."}</p>
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
      {active && sub?.providerCustomerId && !complimentary && <a className="button button-outline" href="/api/billing/portal">Manage billing or cancel</a>}
    </section>
    {active && <section className="panel form-section"><div className="section-heading"><div><p className="eyebrow">Your reach this month</p><h2>Opportunity insight</h2></div><MapPin size={20}/></div><div className="form-grid"><div className="entity-row"><div><b>{receivedThisMonth} matched opportunities</b><small>Received within your current plan, capability and selected coverage.</small></div></div><div className="entity-row"><div><b>{rejectedOutsideRadius} suitable-distance checks outside your radius</b><small>Anonymous count only. Upgrade if a wider area would suit your business; no buyer details are exposed.</small></div></div></div></section>}
    <div className="pricing-grid">
      {plans.map((plan) => {
        const selected = currentPlan?.id === plan.id && active;
        return <section className={`panel form-section ${selected ? "selected-plan" : ""}`} key={plan.id}>
          <div className="section-heading"><div><p className="eyebrow">{plan.tier.toLowerCase()} partner</p><h2>{plan.name}</h2></div>{selected ? <CheckCircle2 size={22}/> : <MapPin size={22}/>}</div>
          <h3>{formatPlanPrice(plan.monthlyPricePence, plan.currency)} <small>{planTaxLabel(plan)}</small></h3>
          <p className="body-copy">{plan.description}</p>
          <div className="entity-list">
            <div className="entity-row"><div><b>{plan.nationwideAllowed ? "Great Britain eligibility" : `Choose 1–${plan.maximumRadiusMiles} miles`}</b><small>Your actual selected radius may be smaller.</small></div></div>
            <div className="entity-row"><div><b>Up to {plan.maximumActiveOpportunities} live opportunities</b><small>No open public job board.</small></div></div>
            <div className="entity-row"><div><b>Strict capability matching</b><small>Product, system, colour, capacity and deadline still required.</small></div></div>
          </div>
          {selected ? <div className="honesty-note">This is your active plan.</div> : plan.tier === "HYPERLOCAL" && !hyperlocalEligible ? <div className="honesty-note">Hyperlocal is not enabled for your selected industries.</div> : company.status !== "APPROVED" ? <div className="honesty-note">Supplier approval is required before checkout.</div> : complimentary && active ? <div className="honesty-note">An administrator can change the tier of active complimentary access.</div> : configured ? <CheckoutButton endpoint="/api/billing/subscription/checkout" body={{ membershipPlanId: plan.id }}>{active ? `Change to ${plan.name}` : `Choose ${plan.name}`}</CheckoutButton> : <div className="honesty-note">Stripe is not configured in this environment.</div>}
        </section>;
      })}
    </div>
    <section className="panel form-section"><div className="section-heading"><div><p className="eyebrow">Secure billing</p><h2>Managed by Stripe</h2></div><ShieldCheck size={20}/></div><p className="body-copy">Bridge AI never stores card details. Plan prices and geographic limits are controlled centrally and enforced on every opportunity.</p><p className="body-copy">Review the <Link href="/legal/terms">supplier terms</Link> and <Link href="/legal/cancellation">subscription and cancellation policy</Link>. Cancellation normally takes effect at the end of the current paid monthly period.</p></section>
  </PortalPage>;
}
