"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Building2, CreditCard, FileText, FolderTree, LayoutDashboard, Link2, MapPin, ShieldAlert } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

const links=[["Overview","/admin",LayoutDashboard],["Suppliers","/admin/suppliers",Building2],["Quote requests","/admin/requests",FileText],["Industries","/admin/categories",FolderTree],["Membership & matching","/admin/membership",CreditCard],["Affiliates","/admin/affiliates",Link2],["Coverage areas","/admin/coverage",MapPin],["Activity logs","/admin/audit",Activity],["System events","/admin/system",ShieldAlert]] as const;
export function AdminShell({name,children}:{name:string;children:React.ReactNode}){const pathname=usePathname();return <div className="portal-shell admin-shell"><aside className="sidebar"><div className="sidebar-head"><BrandMark/></div><div className="admin-label">Administrator console</div><nav className="sidebar-nav">{links.map(([label,href,Icon])=>{const active=href==="/admin"?pathname===href:pathname.startsWith(href);return <Link className={`sidebar-link${active?" active":""}`} href={href} key={href}><Icon size={18}/>{label}</Link>})}</nav><div className="sidebar-bottom"><div className="company-switcher"><span className="avatar avatar-small">{name.split(" ").map(n=>n[0]).join("")}</span><span><b>{name}</b><small>Bridge AI administrator</small></span></div></div></aside><header className="mobile-header"><BrandMark compact/><span>Admin console</span></header><main className="portal-main portal-subpage">{children}</main></div>}

export function AdminHeading({eyebrow,title,description,actions}:{eyebrow:string;title:string;description:string;actions?:React.ReactNode}){return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions&&<div className="heading-actions">{actions}</div>}</div>}
