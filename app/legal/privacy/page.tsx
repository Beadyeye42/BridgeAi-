import type { Metadata } from "next";
import { LegalDocument, LegalSection } from "@/components/legal/legal-document";
import { BRIDGE_AI_COMPANY } from "@/lib/legal/company";

export const metadata: Metadata = { title: "Privacy notice | Bridge-iT", description: "How Bridge-iT collects, uses and protects personal information." };

export default function PrivacyPage() {
  return <LegalDocument title="Privacy notice" summary="This notice explains how Bridge-iT handles information belonging to WhatsApp customers, supplier representatives, affiliates, administrators and website visitors.">
    <LegalSection id="controller" title="1. Who is responsible for your information">
      <p>{BRIDGE_AI_COMPANY.name} is the controller of personal information used to operate Bridge-iT. Our company number is {BRIDGE_AI_COMPANY.companyNumber} and our registered office is {BRIDGE_AI_COMPANY.registeredOffice}.</p>
      <p>Questions or privacy requests can be sent to <a href={`mailto:${BRIDGE_AI_COMPANY.contactEmail}`}>{BRIDGE_AI_COMPANY.contactEmail}</a>.</p>
    </LegalSection>

    <LegalSection id="information" title="2. Information we collect">
      <ul>
        <li><b>Customer information:</b> WhatsApp number, profile name where supplied by WhatsApp, messages, quote requirements, delivery location, photos, drawings, PDFs and other attachments.</li>
        <li><b>Supplier and affiliate information:</b> names, business contact details, company information, team memberships, products, capabilities, coverage, capacity, lead times, referrals and account activity.</li>
        <li><b>Quote and transaction information:</b> requests, assignments, quotations, customer selections, subscription status, Stripe customer and invoice references, and commission ledger records. Bridge-iT does not store full card details.</li>
        <li><b>Technical and security information:</b> IP address, browser and device information, session records, error reports, audit logs and evidence needed to investigate misuse or service failures.</li>
      </ul>
    </LegalSection>

    <LegalSection id="use" title="3. How and why we use it">
      <p>We use information to receive and structure requests, operate supplier accounts, match requests to suitable suppliers, deliver quotations, administer subscriptions and affiliates, prevent fraud, secure the service, resolve disputes and meet legal obligations.</p>
      <p>Our lawful bases are performance of a contract or steps requested before a contract, our legitimate interests in operating and protecting a business sourcing platform, compliance with legal obligations, and consent where the law requires it. We do not rely on consent where another lawful basis is more appropriate.</p>
    </LegalSection>

    <LegalSection id="ai" title="4. AI and supplier matching">
      <p>Bridge-iT uses automated tools to interpret messages and attachments, identify requirements, ask follow-up questions, and filter and rank suppliers using factors such as product capability, specification, coverage, capacity and deadline. AI output can be incomplete or wrong, so customers and suppliers must check important specifications before relying on them.</p>
      <p>AI does not enter a customer or supplier into a final supply contract. Suppliers decide whether and how to quote, customers choose whether to accept, and Bridge-iT administrators can investigate, correct or override matching records. You may ask us to review information or a decision that materially affects you.</p>
    </LegalSection>

    <LegalSection id="sharing" title="5. Who receives information">
      <p>We disclose only what is needed for the service. Matched suppliers see request requirements without unnecessary customer identity details. When a customer selects a quotation, the selected supplier and customer may receive each other’s contact details so they can progress the order.</p>
      <p>We also use service providers for hosting, database, authentication and private storage (Supabase and Vercel), WhatsApp messaging (Meta), AI processing (OpenAI), payment processing (Stripe), transactional email (Resend), and security, monitoring and professional support. They may process information only for the services they provide to us. We may disclose information where required by law, to protect people or the service, or in connection with a properly managed business sale or restructuring.</p>
    </LegalSection>

    <LegalSection id="international" title="6. International transfers">
      <p>Some providers may process information outside the United Kingdom. Where UK data protection law requires it, we use an adequacy regulation, approved contractual safeguards or another lawful transfer mechanism and apply additional security controls where appropriate.</p>
    </LegalSection>

    <LegalSection id="retention" title="7. How long we keep information">
      <p>We keep information only for as long as it is reasonably needed for the purpose collected. Account, quote, payment, affiliate, audit and contractual records may be retained during the relationship and for up to six years afterwards where needed for tax, accounting, legal claims, fraud prevention or dispute evidence. Security logs are generally kept for a shorter operational period unless an investigation requires longer.</p>
      <p>Messages and attachments are kept while a request, quotation, complaint or dispute needs them, then deleted or anonymised in line with our retention process. Backups may take additional time to expire securely.</p>
    </LegalSection>

    <LegalSection id="security" title="8. Security">
      <p>We use access controls, supplier-company isolation, encryption for sensitive customer values, private file storage, signed download links, security scanning, audit records and server-only credentials. No internet service is risk-free, but we investigate suspected incidents and notify affected people or regulators where the law requires it.</p>
    </LegalSection>

    <LegalSection id="rights" title="9. Your rights">
      <p>Depending on the circumstances, you may ask for access, correction, deletion, restriction, portability, or an objection to processing. You may also withdraw consent where processing relies on consent. We may need to verify your identity and may retain information where the law permits or requires it.</p>
      <p>You can complain to the <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noreferrer">Information Commissioner’s Office</a>, although we would appreciate the opportunity to resolve your concern first.</p>
    </LegalSection>

    <LegalSection id="changes" title="10. Children and changes to this notice">
      <p>Bridge-iT is a business and trade sourcing service and is not intended for anyone under 18. We may update this notice when the service, providers or law changes. The effective date at the top identifies the current version.</p>
    </LegalSection>
  </LegalDocument>;
}

