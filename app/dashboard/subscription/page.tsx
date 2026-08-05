import { CreditCard, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { stripeConfigured } from "@/lib/stripe/server";
import { FOUNDING_SUPPLIER_LIMIT, isFoundingSupplier } from "@/lib/billing/pricing";

export const dynamic = "force-dynamic";

export default async function SubscriptionPage() {
  const { session, companyId } = await requireSupplierPage();
  const company = await prisma.supplierCompany.findUniqueOrThrow({ where: { id: companyId }, include: { subscription: true } });
  const sub = company.subscription;
  const configured = stripeConfigured();
  const eligible = isFoundingSupplier(company.foundingMemberNumber);
  const active = sub?.status === "ACTIVE" && (!sub.currentPeriodEnd || sub.currentPeriodEnd > new Date());

  return <PortalPage {...identity(session, company)} eyebrow="Billing" title="Subscription" description="Founding supplier membership with simple monthly pricing and no introduction or winning fees.">
    <div className="management-grid">
      <section className="panel subscription-detail">
        <span className="large-icon"><CreditCard size={24}/></span>
        <p className="eyebrow">Founding supplier membership</p>
        <h2>£29.99 / month</h2>
        <p className="body-copy">For your first six billing months, then £49.99 per month. No VAT is currently charged.</p>
        <span className={`status-pill ${sub?.status.toLowerCase() ?? "pending"}`}>{sub?.status ?? "NOT STARTED"}</span>
        <dl>
          <div><dt>Founding place</dt><dd>{company.foundingMemberNumber ? `#${company.foundingMemberNumber} of ${FOUNDING_SUPPLIER_LIMIT}` : company.status === "APPROVED" ? "Not allocated" : "Allocated on approval"}</dd></div>
          <div><dt>Introduction fees</dt><dd>None</dd></div>
          <div><dt>Winning fees</dt><dd>None</dd></div>
          <div><dt>Current period</dt><dd>{sub?.currentPeriodStart?.toLocaleDateString("en-GB") ?? "—"} – {sub?.currentPeriodEnd?.toLocaleDateString("en-GB") ?? "—"}</dd></div>
          <div><dt>Renewal</dt><dd>{sub?.cancelAtPeriodEnd ? "Cancels at period end" : "Automatic when active"}</dd></div>
        </dl>
      </section>
      <section className="panel form-section">
        <div className="section-heading"><div><p className="eyebrow">Billing controls</p><h2>Managed securely by Stripe</h2></div><ShieldCheck size={20}/></div>
        <p className="body-copy">Bridge AI never stores card details. Stripe securely manages payment details and automatically changes the monthly price after the sixth billing month.</p>
        <div className="honesty-note">Founding membership is strictly limited to the first {FOUNDING_SUPPLIER_LIMIT} approved suppliers.</div>
        {active && sub?.providerCustomerId
          ? <a className="button button-dark" href="/api/billing/portal">Open billing portal</a>
          : !eligible
            ? <div className="honesty-note">A founding place is allocated when Bridge AI approves your supplier account. Checkout remains unavailable until approval.</div>
            : configured
              ? <CheckoutButton endpoint="/api/billing/subscription/checkout">Start founding membership</CheckoutButton>
              : <div className="honesty-note">Stripe is not configured in this environment, so checkout is unavailable. Add both server-only monthly Price IDs and the Stripe secret before accepting payments.</div>}
      </section>
    </div>
  </PortalPage>;
}
