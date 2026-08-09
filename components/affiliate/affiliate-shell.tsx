"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Banknote, Bell, LayoutDashboard, Link2, ReceiptText, Sparkles, Users } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { LogoutButton } from "@/components/auth/logout-button";
import { AffiliateRealtimeRefresh } from "@/components/affiliate/realtime-refresh";

const links = [
  ["Overview", "/affiliate", LayoutDashboard],
  ["My referrals", "/affiliate/referrals", Users],
  ["Earnings", "/affiliate/earnings", ReceiptText],
  ["Payouts", "/affiliate/payouts", Banknote],
  ["Notifications", "/affiliate/notifications", Bell],
] as const;

export function AffiliateShell({ name, affiliateId, maximumActive, unreadNotifications, children }: { name: string; affiliateId: string; maximumActive: number; unreadNotifications: number; children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="portal-shell admin-shell">
    <AffiliateRealtimeRefresh affiliateId={affiliateId} />
    <aside className="sidebar"><div className="sidebar-head"><BrandMark /></div><div className="admin-label">Affiliate portal</div>
      <nav className="sidebar-nav">{links.map(([label, href, Icon]) => <Link className={`sidebar-link${href === "/affiliate" ? pathname === href ? " active" : "" : pathname.startsWith(href) ? " active" : ""}`} href={href} key={href}><Icon size={18} />{label}{href === "/affiliate/notifications" && unreadNotifications > 0 ? <i className="affiliate-nav-count">{Math.min(unreadNotifications, 99)}</i> : null}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="affiliate-sidebar-place"><Sparkles size={15} /><span><b>Founding Affiliate</b><small>One of only {maximumActive} approved places</small></span></div><LogoutButton /><div className="company-switcher"><span className="avatar avatar-small"><Link2 size={16} /></span><span><b>{name}</b><small>Bridge AI affiliate</small></span></div></div>
    </aside>
    <header className="mobile-header"><BrandMark compact /><span>Affiliate portal</span><LogoutButton compact /></header>
    <main className="portal-main portal-subpage">{children}</main>
    <nav className="mobile-nav affiliate-mobile-nav" aria-label="Affiliate mobile navigation">{links.map(([label, href, Icon]) => <Link className={href === "/affiliate" ? pathname === href ? "active" : "" : pathname.startsWith(href) ? "active" : ""} href={href} key={href}><Icon size={19} />{label === "My referrals" ? "Referrals" : label}{href === "/affiliate/notifications" && unreadNotifications > 0 ? <i>{Math.min(unreadNotifications, 99)}</i> : null}</Link>)}</nav>
  </div>;
}
