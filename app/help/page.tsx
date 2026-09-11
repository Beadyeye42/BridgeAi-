import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Mail, MessageCircleMore } from "lucide-react";
import { PublicFooter, PublicHeader } from "@/components/marketing/site-chrome";
import { BRIDGE_AI_COMPANY } from "@/lib/legal/company";

export const metadata: Metadata = { title: "Help & support", description: "Get help with Bridge-iT requests, Buyer Hub access, supplier membership or complaints. Understand supplier approval and quote selection." };

export default function HelpPage() {
  return <div className="home-v2 customer-site"><PublicHeader /><main id="main-content" className="v2-container public-content">
    <div className="public-page-heading"><p className="v2-kicker">HERE TO HELP YOU FIND YOUR NEXT STEP</p><h1>Help with Bridge-iT.</h1><p>Get back to your requests, understand how the service works, or contact the team about a problem.</p></div>
    <div className="public-support-grid"><section className="public-support-card"><MessageCircleMore size={27} /><h2>Looking for your requests?</h2><p>Open the Buyer Hub with the same phone number you used on WhatsApp. You’ll receive a secure sign-in link to view your requests and quotations.</p><Link className="v2-button v2-dark" href="/buyer/login">Open my requests <ArrowUpRight size={17} /></Link></section><section className="public-support-card"><Mail size={27} /><h2>Contact our team</h2><p>For questions, access problems or complaints, email <a href={`mailto:${BRIDGE_AI_COMPANY.contactEmail}`}>{BRIDGE_AI_COMPANY.contactEmail}</a>. Include your request reference, if you have one, and a brief description of the issue.</p><p className="public-note">Please don’t send passwords, card details or unnecessary personal documents. Email support is not a live chat or an emergency service.</p><a className="v2-button v2-outline" href={`mailto:${BRIDGE_AI_COMPANY.contactEmail}`}>Email Bridge-iT <ArrowUpRight size={17} /></a></section></div>
    <div className="public-faq"><h2>Questions before you start</h2>
      <details id="supplier-approval" open><summary>What does supplier approval mean?</summary><p>Suppliers apply with their company identity, business address and contact details. Bridge-iT reviews and approves supplier accounts before they can quote.</p><p>Approval does not guarantee workmanship or mean every supplier has independently verified insurance or accreditation. Check the business, relevant qualifications, insurance and supplier terms for your particular job before agreeing.</p></details>
      <details><summary>Does it cost me anything to request quotes?</summary><p>Bridge-iT currently charges customers no fee to request quotations. You pay the supplier for products or work you agree with them. Normal mobile data charges may apply.</p></details>
      <details><summary>Can I ask a question before choosing?</summary><p>Yes. Open the request in your <Link href="/buyer/login">Buyer Hub</Link> and ask the supplier about the quotation. Check the specification, total price, lead time, delivery and exclusions before selecting.</p></details>
      <details><summary>Is selecting a quote a confirmed order?</summary><p>Selection tells the supplier you prefer their proposal and releases contact details so you can progress it. A final survey, specification, price, deposit or booking may still need to be agreed. Your resulting contract is with the supplier. See the <Link href="/legal/customer-terms">customer terms</Link>.</p></details>
      <details><summary>What if I haven’t received a suitable quote?</summary><p>Responses depend on supplier suitability and availability. Check your request in the Buyer Hub. If you need help understanding its status, email us with the request reference.</p></details>
      <details><summary>How do I raise a complaint?</summary><p>Email our team with the request reference and explain what happened and what outcome you are seeking. For problems with a supplier’s goods or work, also contact that supplier directly. Bridge-iT can look into platform issues and reports about suppliers; it does not guarantee a supplier refund or the quality of their work.</p></details>
      <details><summary>I’m a supplier. Where do I manage my account?</summary><p><Link href="/login">Sign in to the supplier workspace</Link> for your profile, requests and membership. You can compare the <Link href="/pricing">current membership plans</Link> without signing in, or email us about approval, access or billing.</p></details>
    </div>
  </main><PublicFooter /></div>;
}
