"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Gift, History, House, LogOut, RotateCcw, UserRound } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { BuyerRealtimeRefresh } from "@/components/buyer/buyer-realtime-refresh";

const links = [
  ["Overview", "/buyer", House],
  ["My requests", "/buyer/requests", ClipboardList],
  ["Orders", "/buyer/orders", History],
  ["Reorder", "/buyer/reorder", RotateCcw],
  ["Rewards", "/buyer/rewards", Gift],
  ["Account", "/buyer/account", UserRound],
] as const;

export function BuyerShell({ buyerId, firstName, children }: { buyerId: string; firstName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="buyer-shell">
    <aside className="buyer-sidebar">
      <div className="buyer-sidebar-brand"><BrandMark /></div>
      <p className="eyebrow">Buyer Hub</p>
      <nav aria-label="Buyer Hub navigation">{links.map(([label, href, Icon]) => <Link key={href} href={href} className={href === "/buyer" ? pathname === href ? "active" : "" : pathname.startsWith(href) ? "active" : ""}><Icon size={18} />{label}</Link>)}</nav>
      <div className="buyer-sidebar-foot"><span>Signed in as <b>{firstName}</b></span><form action="/api/buyer/auth/logout" method="post"><button><LogOut size={17} />Sign out</button></form></div>
    </aside>
    <header className="buyer-mobile-head"><BrandMark compact /><span>Buyer Hub</span></header>
    <BuyerRealtimeRefresh buyerId={buyerId} />
    <main className="buyer-main">{children}</main>
  </div>;
}
