import Link from "next/link";
import { ArrowUpRight, Menu, MessageCircleMore } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { BRIDGE_AI_COMPANY } from "@/lib/legal/company";

export const WHATSAPP_REQUEST_URL = "https://wa.me/447593103459?text=Hi%20Bridge-iT%2C%20I%20need%20help%20finding%20a%20quote.";

export function PublicHeader({ supplier = false }: { supplier?: boolean }) {
  return <>
    <a className="v2-skip" href="#main-content">Skip to content</a>
    <header className="v2-nav public-nav">
      <Link href="/" aria-label="Bridge-iT home"><BrandMark /></Link>
      <nav aria-label="Public navigation"><Link href="/#how-it-works">How it works</Link><Link href="/suppliers">For suppliers</Link><Link href="/help">Help & support</Link></nav>
      <div className="v2-nav-actions">
        <Link href={supplier ? "/login" : "/buyer/login"}>{supplier ? "Supplier sign in" : "My requests"}</Link>
        {supplier ? <Link className="v2-button v2-dark" href="/register">Join as a supplier <ArrowUpRight size={16} /></Link> : <a className="v2-button v2-dark" href={WHATSAPP_REQUEST_URL} target="_blank" rel="noreferrer">Get quotes <MessageCircleMore size={16} /></a>}
      </div>
      <details className="public-mobile-menu">
        <summary aria-label="Open navigation"><Menu size={22} /></summary>
        <nav aria-label="Mobile navigation"><Link href="/#how-it-works">How it works</Link><Link href="/suppliers">For suppliers</Link><Link href="/pricing">Supplier pricing</Link><Link href="/buyer/login">My requests</Link><Link href="/login">Supplier sign in</Link><Link href="/help">Help & support</Link></nav>
      </details>
    </header>
  </>;
}

export function PublicFooter() {
  return <footer className="v2-footer v2-container public-footer">
    <div><Link href="/" aria-label="Bridge-iT home"><BrandMark /></Link><p>One request. A clearer choice.</p></div>
    <nav aria-label="Footer navigation"><Link href="/buyer/login">My requests</Link><Link href="/suppliers">For suppliers</Link><Link href="/pricing">Supplier pricing</Link><Link href="/help">Help & support</Link><Link href="/legal/customer-terms">Customer terms</Link><Link href="/legal/terms">Supplier terms</Link><Link href="/legal/privacy">Privacy</Link><Link href="/legal/cookies">Cookies</Link><Link href="/legal/cancellation">Cancellation</Link></nav>
    <small>Bridge-iT is operated by {BRIDGE_AI_COMPANY.name}. Company number {BRIDGE_AI_COMPANY.companyNumber}. <Link href="/help">Contact us</Link></small>
  </footer>;
}
