import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Mail } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { BRIDGE_AI_COMPANY, LEGAL_EFFECTIVE_DATE } from "@/lib/legal/company";

const legalLinks = [
  ["Privacy", "/legal/privacy"],
  ["Supplier terms", "/legal/terms"],
  ["Customer terms", "/legal/customer-terms"],
  ["Cancellation", "/legal/cancellation"],
  ["Cookies", "/legal/cookies"],
] as const;

export function LegalDocument({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <main className="legal-shell">
      <header className="legal-topbar">
        <Link href="/" aria-label="Bridge AI home"><BrandMark /></Link>
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Bridge AI home</Link>
      </header>
      <article className="legal-page">
        <div className="legal-heading">
          <p className="eyebrow">{BRIDGE_AI_COMPANY.name}</p>
          <h1>{title}</h1>
          <p>{summary}</p>
          <span>Effective {LEGAL_EFFECTIVE_DATE}</span>
        </div>

        <nav className="legal-nav" aria-label="Legal documents">
          {legalLinks.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>

        <div className="legal-content">{children}</div>

        <aside className="legal-company-card">
          <div><Building2 size={18} /><span><b>{BRIDGE_AI_COMPANY.name}</b><small>Company number {BRIDGE_AI_COMPANY.companyNumber}<br />Registered in {BRIDGE_AI_COMPANY.jurisdiction}<br />{BRIDGE_AI_COMPANY.registeredOffice}</small></span></div>
          <a href={`mailto:${BRIDGE_AI_COMPANY.contactEmail}`}><Mail size={16} /> {BRIDGE_AI_COMPANY.contactEmail}</a>
        </aside>
      </article>
    </main>
  );
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section className="legal-section" id={id}><h2>{title}</h2>{children}</section>;
}

