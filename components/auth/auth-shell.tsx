import Link from "next/link";
import { ArrowLeft, CheckCircle2, MessagesSquare, Quote, ShieldCheck, Sparkles } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export function AuthShell({ children, title, description, footer }: { children: React.ReactNode; title: string; description: string; footer?: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="story-glow" />
        <BrandMark />
        <div className="story-copy"><p className="eyebrow">Built for approved suppliers</p><h1>Qualified opportunities.<br /><em>One clear workflow.</em></h1><p>Bridge AI turns customer WhatsApp enquiries into structured quote requests—so your team can respond faster and win more of the right work.</p><div className="story-points"><span><CheckCircle2 size={16} />No cold leads or public bidding</span><span><CheckCircle2 size={16} />Customer details protected by design</span><span><CheckCircle2 size={16} />A complete, auditable quote history</span></div></div>
        <blockquote><Quote size={18} /><p>“We spend less time qualifying enquiries and more time pricing work that fits our capability.”</p><footer><span>JM</span><div><b>James Morton</b><small>Commercial Director · approved supplier</small></div></footer></blockquote>
        <div className="story-orbit one"><MessagesSquare size={18} /></div><div className="story-orbit two"><Sparkles size={15} /></div>
        <p className="owner-line">A platform by Ironbridge Group Ltd</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card"><Link href="/" className="back-link"><ArrowLeft size={14} />Back to preview</Link><div className="auth-heading"><div className="auth-shield"><ShieldCheck size={20} /></div><h2>{title}</h2><p>{description}</p></div>{children}{footer && <div className="auth-footer">{footer}</div>}</div>
      </section>
    </main>
  );
}
