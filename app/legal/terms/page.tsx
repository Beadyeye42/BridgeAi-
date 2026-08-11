import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalSection } from "@/components/legal/legal-document";
import { BRIDGE_AI_COMPANY } from "@/lib/legal/company";

export const metadata: Metadata = { title: "Supplier terms | Bridge AI", description: "Terms for approved suppliers using the Bridge AI portal." };

export default function TermsPage() {
  return <LegalDocument title="Supplier terms" summary="These business-to-business terms govern supplier applications, memberships, quote access and use of the Bridge AI portal.">
    <LegalSection id="parties" title="1. About these terms">
      <p>These terms form an agreement between {BRIDGE_AI_COMPANY.name} (“Bridge AI”, “we”, “us”) and the company applying for or using a supplier workspace (“Supplier”, “you”). The person accepting them confirms that they are at least 18 and authorised to bind the Supplier.</p>
    </LegalSection>

    <LegalSection id="service" title="2. What Bridge AI provides">
      <p>Bridge AI turns customer WhatsApp enquiries and supporting files into structured requests and matches them to eligible suppliers. It provides a secure workspace for reviewing opportunities and submitting quotations. Bridge AI is an intermediary, not the manufacturer, installer, designer, engineer, merchant or customer.</p>
      <p>We do not guarantee any number, value or suitability of opportunities, that a customer will select or complete an order, or that information supplied by a customer is complete or accurate.</p>
    </LegalSection>

    <LegalSection id="approval" title="3. Application, approval and accounts">
      <ul>
        <li>Information supplied during registration and onboarding must be complete, current and accurate.</li>
        <li>We may verify the business, its representatives and its stated capabilities before approving or continuing access.</li>
        <li>Login details are personal to the authorised user and must not be shared. Team members must use their own authorised account.</li>
        <li>You must promptly update company, product, capability, capacity, coverage and contact information.</li>
      </ul>
    </LegalSection>

    <LegalSection id="membership" title="4. Membership and opportunity access">
      <p>A paid or authorised complimentary membership is required to quote unless we state otherwise in writing. The selected plan controls geographic reach and the maximum number of live opportunities. Matching also depends on confirmed products, systems, colours, capacity, lead times and other mandatory requirements.</p>
      <p>If payment ends, fails or is cancelled, access continues only until the paid period ends where applicable. After that point the Supplier cannot access or submit new quotations. See the <Link href="/legal/cancellation">subscription and cancellation policy</Link>.</p>
    </LegalSection>

    <LegalSection id="quotes" title="5. Requests and quotations">
      <p>Unless the request displays a different deadline, suppliers normally have two days to quote and the customer’s request remains valid for seven days. A quotation must clearly state the price, applicable taxes, lead time, validity period, inclusions, exclusions and material assumptions.</p>
      <p>You are responsible for checking dimensions, specification, standards, compliance, availability, delivery and whether a survey, design or engineering work is required. Customer selection means the customer wants to move forward with your quotation; it is not automatically a confirmed job. Record the job as confirmed only after the final order, booking, hire or work has been agreed. Any resulting supply or service contract is between the Supplier and customer; Bridge AI is not a party to it.</p>
    </LegalSection>

    <LegalSection id="customer-data" title="6. Customer information and files">
      <p>Customer identity and contact details must not be sought, extracted or shared before Bridge AI releases them following a valid quotation selection. Requirements and attachments may be used only to assess and fulfil the relevant request. You must apply appropriate confidentiality and security and delete local copies when no longer needed.</p>
    </LegalSection>

    <LegalSection id="conduct" title="7. Acceptable use">
      <p>You must not misuse the service, scrape requests, bypass matching or plan limits, contact protected customers, submit misleading quotations, upload unlawful or malicious content, probe security, impersonate another person, or use information for unrelated marketing. Suspected errors or vulnerabilities should be reported to us and not exploited.</p>
    </LegalSection>

    <LegalSection id="payments" title="8. Charges, tax and plan changes">
      <p>Current prices and plan limits are shown before checkout. Stripe processes payments and card details. Plan changes may result in a prorated charge or credit shown through Stripe before confirmation.</p>
      <p>Monthly fees are normally non-refundable once a billing period has started, except where required by law or where we agree that an incorrect charge or service failure justifies a refund.</p>
    </LegalSection>

    <LegalSection id="suspension" title="9. Suspension and termination">
      <p>We may restrict or suspend access to protect customers, suppliers or the platform, investigate suspected misuse or fraud, respond to non-payment, comply with law, or address materially inaccurate capability information. We will act proportionately and explain the reason where lawful and practicable.</p>
      <p>Either party may end the relationship. Subscription cancellation is governed by the cancellation policy. Provisions concerning confidentiality, customer data, payment, liability, audit records and disputes continue where their nature requires it.</p>
    </LegalSection>

    <LegalSection id="liability" title="10. Responsibility and liability">
      <p>Nothing in these terms excludes liability that cannot lawfully be excluded, including liability for death or personal injury caused by negligence, fraud or fraudulent misrepresentation. Subject to that, Bridge AI is not responsible for indirect or consequential loss, loss of profit, revenue, opportunity, data or goodwill, or the acts, products or services of customers, suppliers or third parties.</p>
      <p>Our total liability arising from the service in any 12-month period will not exceed the membership fees paid by the Supplier in that period. This limit does not apply where the law does not permit it.</p>
    </LegalSection>

    <LegalSection id="general" title="11. General terms">
      <p>The Supplier keeps ownership of its materials and grants us the rights needed to host, process and transmit them for the service. We own Bridge AI, its software and branding. If part of these terms is unenforceable, the rest remains effective. Delay in enforcing a right is not a waiver.</p>
      <p>We may update these terms for legal, security or service changes. Material changes will be notified through the portal or registered email and may require renewed acceptance. These terms are governed by the law of England and Wales, and its courts have exclusive jurisdiction.</p>
    </LegalSection>
  </LegalDocument>;
}
