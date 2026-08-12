import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalSection } from "@/components/legal/legal-document";
import { BRIDGE_AI_COMPANY } from "@/lib/legal/company";

export const metadata: Metadata = { title: "Cancellation policy | Bridge-iT", description: "How Bridge-iT supplier subscriptions can be changed or cancelled." };

export default function CancellationPage() {
  return <LegalDocument title="Subscription and cancellation policy" summary="A clear explanation of billing, plan changes, cancellation, access at the end of a paid period and refunds for Bridge-iT supplier memberships.">
    <LegalSection id="scope" title="1. Business subscriptions">
      <p>Bridge-iT supplier memberships are business-to-business monthly subscriptions. Customers requesting quotations through WhatsApp do not hold portal subscriptions and are not charged a Bridge-iT request fee under the current service.</p>
    </LegalSection>
    <LegalSection id="cancel" title="2. How to cancel">
      <p>An authorised account owner can open <b>Dashboard → Subscription → Manage billing or cancel</b> and cancel through Stripe’s secure billing portal. If the portal is unavailable, email <a href={`mailto:${BRIDGE_AI_COMPANY.contactEmail}`}>{BRIDGE_AI_COMPANY.contactEmail}</a> from the registered account address with the company name and a clear cancellation request.</p>
      <p>Deleting an app, stopping use or removing a payment method does not by itself cancel a subscription. We provide a confirmation when a cancellation has been scheduled.</p>
    </LegalSection>
    <LegalSection id="timing" title="3. When cancellation takes effect">
      <p>Cancellation normally takes effect at the end of the current paid monthly period. The Supplier can continue using the paid plan until that date. After the period ends, it loses access to new opportunities and cannot submit new quotations. Historical and audit records may remain available to Bridge-iT where needed for accounting, disputes, security or legal obligations.</p>
    </LegalSection>
    <LegalSection id="charges" title="4. Charges and refunds">
      <p>We do not normally provide a partial refund for unused days in a monthly period. This does not affect a right to a refund required by law. If you believe a charge is duplicated, incorrect or the result of a material service failure, contact us promptly so we can investigate.</p>
    </LegalSection>
    <LegalSection id="changes" title="5. Upgrades, downgrades and failed payments">
      <p>Stripe shows any immediate prorated charge or credit before a plan change is confirmed. A lower plan may require the Supplier to reduce its selected coverage or active opportunities to that plan’s limits. If payment fails, Stripe may retry it and Bridge-iT may restrict access when the paid period or any permitted grace period ends.</p>
    </LegalSection>
    <LegalSection id="promotions" title="6. Complimentary and promotional access">
      <p>Complimentary access ends on the date or condition recorded by the administrator and does not renew as a paid plan unless the Supplier actively completes checkout. A time-limited promotional price changes to the displayed standard price after the promotion unless cancelled before the next billing period.</p>
    </LegalSection>
    <LegalSection id="customer-requests" title="7. Cancelling a WhatsApp request">
      <p>A customer can tell Bridge-iT to cancel a current draft in WhatsApp before it is published. Once a supplier and customer have entered their own contract, cancellation of that order is governed by the supplier’s terms, not this subscription policy. See the <Link href="/legal/customer-terms">customer terms</Link>.</p>
    </LegalSection>
  </LegalDocument>;
}

