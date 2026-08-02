"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bell, Building2, ChevronDown, CreditCard, FileText, HelpCircle, LayoutDashboard, MapPin, Settings, Users } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

const primary = [
  { label: "Overview", icon: LayoutDashboard, href: "/dashboard" },
  { label: "Quote requests", icon: FileText, href: "/dashboard/requests", badge: "4" },
  { label: "Performance", icon: BarChart3, href: "/dashboard/performance" },
];
const management = [
  { label: "Company profile", icon: Building2, href: "/dashboard/company" },
  { label: "Coverage areas", icon: MapPin, href: "/dashboard/coverage" },
  { label: "Team members", icon: Users, href: "/dashboard/team" },
  { label: "Subscription", icon: CreditCard, href: "/dashboard/subscription" },
];

export function Sidebar({ companyName, initials }: { companyName: string; initials: string }) {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="sidebar-head"><BrandMark /></div>
      <nav className="sidebar-nav" aria-label="Supplier navigation">
        <p className="nav-label">Workspace</p>
        {primary.map((item) => <NavItem key={item.label} {...item} active={item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href)} />)}
        <p className="nav-label nav-label-spaced">Manage</p>
        {management.map((item) => <NavItem key={item.label} {...item} active={pathname.startsWith(item.href)} />)}
      </nav>
      <div className="sidebar-bottom">
        <Link href="/dashboard/notifications" className={`sidebar-link${pathname.startsWith("/dashboard/notifications") ? " active" : ""}`}><Bell size={18} />Notifications<span className="nav-dot" /></Link>
        <Link href="/dashboard/settings" className={`sidebar-link${pathname.startsWith("/dashboard/settings") ? " active" : ""}`}><Settings size={18} />Settings</Link>
        <Link href="/help" className="sidebar-link"><HelpCircle size={18} />Help centre</Link>
        <div className="company-switcher">
          <span className="avatar avatar-small">{initials}</span>
          <span><b>{companyName}</b><small>Approved supplier</small></span>
          <ChevronDown size={15} />
        </div>
      </div>
    </aside>
  );
}

function NavItem({ label, icon: Icon, href, badge, active }: { label: string; icon: typeof LayoutDashboard; href: string; badge?: string; active?: boolean }) {
  return <Link href={href} className={`sidebar-link${active ? " active" : ""}`}><Icon size={18} />{label}{badge && <span className="nav-badge">{badge}</span>}</Link>;
}
