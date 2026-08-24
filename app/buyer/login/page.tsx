import Link from "next/link";
import { BuyerLoginForm } from "@/components/buyer/buyer-login-form";
import { BRAND_NAME } from "@/lib/brand";

export const metadata = { title: `Buyer sign in | ${BRAND_NAME}` };

export default async function BuyerLoginPage({ searchParams }: { searchParams: Promise<{ next?: string; auth?: string }> }) {
  const params = await searchParams;
  const next = params.next?.startsWith("/buyer") && !params.next.startsWith("//") ? params.next : "/buyer";
  return <main className="buyer-auth-page">
    <section className="buyer-auth-story">
      <Link href="/" className="buyer-wordmark">{BRAND_NAME}</Link>
      <p className="eyebrow">WhatsApp first. Buyer Hub for control.</p>
      <h1>Every request, quote and order in one secure place.</h1>
      <p>Use the same WhatsApp number you use with {BRAND_NAME}. We’ll send a private, single-use link that expires after ten minutes.</p>
      <ul><li>No password to remember</li><li>No supplier identities exposed before selection</li><li>Your documents remain private</li></ul>
    </section>
    <section className="buyer-auth-panel">
      <div>
        <p className="eyebrow">Buyer Hub</p>
        <h2>Sign in with WhatsApp</h2>
        <p>Enter your number below. For your protection, we never confirm whether a number is registered on this screen.</p>
        {params.auth === "invalid" ? <p className="buyer-auth-error">That link is invalid, expired or has already been used. Request a new one below.</p> : null}
        <BuyerLoginForm next={next} />
        <p className="buyer-auth-small">A secure Supabase session protects your trusted device for up to 30 days. You can sign out at any time.</p>
      </div>
    </section>
  </main>;
}
