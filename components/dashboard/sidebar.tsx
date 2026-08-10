"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bell, Building2, ChevronDown, CreditCard, FileText, Gauge, HelpCircle, LayoutDashboard, MapPin, Settings, Users } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { LogoutButton } from "@/components/auth/logout-button";

const primary = [
  { label: "Overview", icon: LayoutDashboard, href: "/dashboard" },
  { label: "Bridge Requests", icon: FileText, href: "/dashboard/requests" },
  { label: "Performance", icon: BarChart3, href: "/dashboard/performance" },
];
const management = [
  { label: "Company profile", icon: Building2, href: "/dashboard/company" },
  { label: "Capabilities", icon: Gauge, href: "/dashboard/capabilities" },
  { label: "Coverage areas", icon: MapPin, href: "/dashboard/coverage" },
  { label: "Team members", icon: Users, href: "/dashboard/team" },
  { label: "Subscription", icon: CreditCard, href: "/dashboard/subscription" },
];

export function Sidebar({ companyName, initials, companyStatus, activeRequestCount = 0, unreadNotificationCount = 0, demo = false }: { companyName: string; initials: string; companyStatus: string; activeRequestCount?: number; unreadNotificationCount?: number; demo?: boolean }) {
  const pathname = usePathname();
  const visiblePrimary = demo ? [
    { label: "Overview", icon: LayoutDashboard, href: "/demo" },
    { label: "Sample request", icon: FileText, href: "/requests/BA-2026-0842" },
  ] : primary;
  return (
    <aside className="sidebar">
      <div className="sidebar-head"><BrandMark /></div>
      <nav className="sidebar-nav" aria-label="Supplier navigation">
        <p className="nav-label">Workspace</p>
        {visiblePrimary.map((item) => <NavItem key={item.label} {...item} badge={!demo && item.href === "/dashboard/requests" && activeRequestCount > 0 ? String(activeRequestCount) : undefined} active={item.href === "/dashboard" || item.href === "/demo" ? pathname === item.href : pathname.startsWith(item.href)} />)}
        {!demo && <><p className="nav-label nav-label-spaced">Manage</p>{management.map((item) => <NavItem key={item.label} {...item} active={pathname.startsWith(item.href)} />)}</>}
      </nav>
      <div className="sidebar-bottom">
        {demo ? <>
          <Link href="/login" className="sidebar-link"><Users size={18} />Supplier sign in</Link>
          <Link href="/register" className="sidebar-link"><Building2 size={18} />Apply to join</Link>
        </> : <>
          <Link href="/dashboard/notifications" className={`sidebar-link${pathname.startsWith("/dashboard/notifications") ? " active" : ""}`}><Bell size={18} />Notifications{unreadNotificationCount > 0 && <span className="nav-dot" />}</Link>
          <Link href="/dashboard/settings" className={`sidebar-link${pathname.startsWith("/dashboard/settings") ? " active" : ""}`}><Settings size={18} />Settings</Link>
        </>}
        <Link href="/help" className="sidebar-link"><HelpCircle size={18} />Help centre</Link>
        {!demo && <LogoutButton />}
        <div className="company-switcher">
          <span className="avatar avatar-small">{initials}</span>
          <span><b>{companyName}</b><small>{demo ? "Demonstration workspace" : statusLabel(companyStatus)}</small></span>
          {!demo && <ChevronDown size={15} />}
        </div>
      </div>
    </aside>
  );
}

function statusLabel(status: string) {
  if (status === "APPROVED") return "Approved supplier";
  if (status === "PENDING") return "Approval pending";
  if (status === "SUSPENDED") return "Supplier suspended";
  if (status === "REJECTED") return "Application declined";
  return "Supplier account";
}

function NavItem({ label, icon: Icon, href, badge, active }: { label: string; icon: typeof LayoutDashboard; href: string; badge?: string; active?: boolean }) {
  return <Link href={href} className={`sidebar-link${active ? " active" : ""}`}><Icon size={18} />{label}{badge && <span className="nav-badge">{badge}</span>}</Link>;
}
