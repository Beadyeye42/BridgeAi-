import Link from "next/link";
import { ArrowLeft, CheckCircle2, MessagesSquare, ShieldCheck, Sparkles } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export function AuthShell({ children, title, description, footer }: { children: React.ReactNode; title: string; description: string; footer?: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="story-glow" />
        <BrandMark />
        <div className="story-copy"><p className="eyebrow">Built for approved suppliers</p><h1>Good work.<br /><em>Closer to home.</em></h1><p>Make your skills and availability count. Review nearby requests, choose the work that fits and keep your quotations in one place.</p><div className="story-points"><span><CheckCircle2 size={16} />Private quotations, not public bidding</span><span><CheckCircle2 size={16} />Customer details protected by design</span><span><CheckCircle2 size={16} />A complete, auditable quote history</span></div></div>
        <div className="auth-value-note"><p className="eyebrow">YOUR BUSINESS. YOUR CHOICE.</p><p>Set your services and coverage. Choose which requests to quote. Keep control of the work you take on.</p></div>
        <div className="story-orbit one"><MessagesSquare size={18} /></div><div className="story-orbit two"><Sparkles size={15} /></div>
        <p className="owner-line">A platform by Ironbridge Group Ltd</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card"><Link href="/" className="back-link"><ArrowLeft size={14} />Bridge-iT home</Link><div className="auth-heading"><div className="auth-shield"><ShieldCheck size={20} /></div><h2>{title}</h2><p>{description}</p></div>{children}{footer && <div className="auth-footer">{footer}</div>}</div>
      </section>
    </main>
  );
}
