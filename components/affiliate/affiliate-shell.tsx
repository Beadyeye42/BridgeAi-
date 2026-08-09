"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Banknote, Bell, LayoutDashboard, Link2, ReceiptText, Users } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { AffiliateRealtimeRefresh } from "@/components/affiliate/realtime-refresh";

const links = [
  ["Overview", "/affiliate", LayoutDashboard],
  ["My referrals", "/affiliate/referrals", Users],
  ["Earnings", "/affiliate/earnings", ReceiptText],
  ["Payouts", "/affiliate/payouts", Banknote],
  ["Notifications", "/affiliate/notifications", Bell],
] as const;

export function AffiliateShell({ name, affiliateId, children }: { name: string; affiliateId: string; children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="portal-shell admin-shell">
    <AffiliateRealtimeRefresh affiliateId={affiliateId} />
    <aside className="sidebar"><div className="sidebar-head"><BrandMark /></div><div className="admin-label">Affiliate portal</div>
      <nav className="sidebar-nav">{links.map(([label, href, Icon]) => <Link className={`sidebar-link${href === "/affiliate" ? pathname === href ? " active" : "" : pathname.startsWith(href) ? " active" : ""}`} href={href} key={href}><Icon size={18} />{label}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="company-switcher"><span className="avatar avatar-small"><Link2 size={16} /></span><span><b>{name}</b><small>Bridge AI affiliate</small></span></div></div>
    </aside>
    <header className="mobile-header"><BrandMark compact /><span>Affiliate portal</span></header>
    <main className="portal-main portal-subpage">{children}</main>
  </div>;
}
