import Link from "next/link";
import { Bell, FileText, LayoutDashboard, MoreHorizontal } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Sidebar } from "@/components/dashboard/sidebar";

export function PortalPage({
  companyName,
  initials,
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  companyName: string;
  initials: string;
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return <div className="portal-shell">
    <Sidebar companyName={companyName} initials={initials} />
    <header className="mobile-header"><BrandMark compact /><span>{companyName}</span><Link href="/dashboard/notifications" className="icon-button"><Bell size={18} /></Link></header>
    <main className="portal-main portal-subpage">
      <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions && <div className="heading-actions">{actions}</div>}</div>
      {children}
    </main>
    <nav className="mobile-nav" aria-label="Mobile navigation"><Link href="/dashboard"><LayoutDashboard size={20} />Overview</Link><Link href="/dashboard/requests"><FileText size={20} />Requests</Link><Link href="/dashboard/company"><BrandMark compact />Company</Link><Link href="/dashboard/settings"><MoreHorizontal size={20} />More</Link></nav>
  </div>;
}

export function identity(session: { user: { firstName: string; lastName: string } }, company: { legalName: string; tradingName: string | null }) {
  return {
    companyName: company.tradingName ?? company.legalName,
    initials: `${session.user.firstName[0] ?? ""}${session.user.lastName[0] ?? ""}`,
  };
}
