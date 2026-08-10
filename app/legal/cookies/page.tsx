import type { Metadata } from "next";
import { LegalDocument, LegalSection } from "@/components/legal/legal-document";
import { BRIDGE_AI_COMPANY } from "@/lib/legal/company";

export const metadata: Metadata = { title: "Cookie notice | Bridge AI", description: "Cookies and similar technologies used by Bridge AI." };

export default function CookiesPage() {
  return <LegalDocument title="Cookie notice" summary="Bridge AI currently uses cookies needed to keep accounts secure, remember sessions and preserve a supplier referral when somebody follows an affiliate link.">
    <LegalSection id="cookies" title="1. What cookies are">
      <p>Cookies are small text files stored by a browser. Similar storage technologies may serve the same purpose. They can keep a user signed in, protect a request, remember a choice or measure how a service is used.</p>
    </LegalSection>
    <LegalSection id="used" title="2. What Bridge AI uses">
      <div className="legal-table-wrap"><table className="legal-table"><thead><tr><th>Purpose</th><th>Use</th><th>Typical duration</th></tr></thead><tbody>
        <tr><td>Authentication and session</td><td>Supabase session cookies keep authorised users signed in and allow protected pages to verify the user.</td><td>Session or the authentication period</td></tr>
        <tr><td>Security and service operation</td><td>Hosting and application controls may use short-lived values to route traffic, prevent abuse and protect forms and sessions.</td><td>Session or short operational period</td></tr>
        <tr><td>Affiliate referral</td><td><code>bridge_affiliate_ref</code> preserves the referral chosen when a supplier intentionally follows an affiliate link, so the requested attribution is applied at registration.</td><td>Up to 30 days</td></tr>
      </tbody></table></div>
      <p>We do not currently use advertising cookies or general behavioural advertising trackers. If we introduce non-essential analytics or marketing cookies, we will provide an appropriate consent choice before setting them.</p>
    </LegalSection>
    <LegalSection id="controls" title="3. Browser controls">
      <p>You can delete or block cookies using browser settings. Blocking authentication or security cookies will prevent supplier, affiliate or administrator portal features from working correctly. Removing the referral cookie may mean an affiliate is not credited for a registration.</p>
    </LegalSection>
    <LegalSection id="changes" title="4. Changes and contact">
      <p>We update this notice if the cookies or providers used by Bridge AI change. Questions can be sent to <a href={`mailto:${BRIDGE_AI_COMPANY.contactEmail}`}>{BRIDGE_AI_COMPANY.contactEmail}</a>. Personal information associated with cookies is handled under our <a href="/legal/privacy">privacy notice</a>.</p>
    </LegalSection>
  </LegalDocument>;
}
