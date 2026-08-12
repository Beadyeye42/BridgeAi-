import type { Metadata } from "next";
import { LegalDocument, LegalSection } from "@/components/legal/legal-document";
import { BRIDGE_AI_COMPANY } from "@/lib/legal/company";

export const metadata: Metadata = { title: "Customer terms | Bridge-iT", description: "Terms for customers requesting supplier quotations through Bridge-iT on WhatsApp." };

export default function CustomerTermsPage() {
  return <LegalDocument title="Customer WhatsApp terms" summary="These terms apply when a customer asks Bridge-iT to source quotations by WhatsApp. Customers do not create or use portal accounts.">
    <LegalSection id="service" title="1. The service">
      <p>{BRIDGE_AI_COMPANY.name} operates Bridge-iT as a sourcing and quotation-matching service. You can describe what you need and send photos, drawings or documents. Bridge-iT may use AI to interpret the request, ask questions, prepare a summary and find suitable approved suppliers.</p>
      <p>Bridge-iT does not currently charge customers a fee to request quotations. Normal WhatsApp or mobile data charges from your provider may apply.</p>
    </LegalSection>
    <LegalSection id="your-information" title="2. Information you send">
      <p>You must provide information you reasonably believe is accurate and have the right to share every file you send. Do not send unnecessary identification, payment-card details, passwords, medical information, unlawful material or information belonging to someone else without authority.</p>
      <p>You must check Bridge-iT’s summary and correct any misunderstanding before confirming publication. Images and AI interpretations are not a substitute for a survey, engineering review or final technical specification.</p>
    </LegalSection>
    <LegalSection id="quotes" title="3. Supplier quotations">
      <p>Quotations come from independent suppliers. Bridge-iT may filter and rank suppliers, but it does not guarantee the lowest price, availability, quality, compliance or fitness for purpose. Check the price, tax, lead time, specification, exclusions, warranty, delivery and supplier terms before selecting.</p>
      <p>Selecting a quote tells the supplier that you prefer its proposal and want to move forward. Selection alone does not necessarily create a confirmed order, booking, hire or works contract. You and the supplier must agree any final survey, specification, availability, price, deposit, booking or delivery arrangements. Any resulting contract is with that supplier, not Bridge-iT.</p>
    </LegalSection>
    <LegalSection id="contact" title="4. Contact details and privacy">
      <p>Your contact details are withheld from quoting suppliers unless needed to progress the service. After you select a quotation, Bridge-iT may share your contact details with that supplier and share the supplier’s details with you. Our <a href="/legal/privacy">privacy notice</a> explains the processing in detail.</p>
    </LegalSection>
    <LegalSection id="cancel" title="5. Changes and cancellation">
      <p>You can correct a draft or tell Bridge-iT to cancel it before publication. A published request normally remains open for seven days unless you cancel it, select a quote or a different deadline is shown. A selected proposal can still be recorded as not proceeding if final arrangements are not agreed. After entering a contract with a supplier, changes, cancellation and refunds are governed by that supplier’s terms and applicable law.</p>
    </LegalSection>
    <LegalSection id="conduct" title="6. Safe and acceptable use">
      <p>You must not use Bridge-iT for unlawful, abusive, fraudulent or harmful requests, impersonate another person, upload malicious files, or attempt to bypass security. We may pause or refuse a request to protect people, suppliers or the service.</p>
    </LegalSection>
    <LegalSection id="liability" title="7. Liability and contact">
      <p>Nothing excludes liability that cannot legally be excluded. Subject to that, Bridge-iT is not liable for an independent supplier’s goods, services, statements or failure to perform, or for losses caused by inaccurate customer information. These terms are governed by the law of England and Wales.</p>
      <p>Questions or complaints can be sent to <a href={`mailto:${BRIDGE_AI_COMPANY.contactEmail}`}>{BRIDGE_AI_COMPANY.contactEmail}</a>.</p>
    </LegalSection>
  </LegalDocument>;
}
