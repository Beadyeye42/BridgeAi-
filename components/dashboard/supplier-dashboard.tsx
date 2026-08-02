import Link from "next/link";
import { ArrowUpRight, Bell, BriefcaseBusiness, CheckCircle2, ChevronRight, CircleGauge, Clock3, FileCheck2, FileText, HelpCircle, MapPin, MoreHorizontal, Paperclip, Plus, Search, Sparkles, Target, TrendingUp } from "lucide-react";
import type { DashboardData } from "@/lib/demo-data";
import { Sidebar } from "./sidebar";
import { BrandMark } from "@/components/brand-mark";

export function SupplierDashboard({ data, demo = false }: { data: DashboardData; demo?: boolean }) {
  const requestBase = demo ? "/requests" : "/dashboard/requests";
  return (
    <div className="portal-shell">
      <Sidebar companyName={data.companyName} initials={data.initials} />
      <header className="mobile-header"><BrandMark compact /><span>{data.companyName}</span><button className="icon-button" aria-label="Notifications"><Bell size={19} /></button></header>
      <main className="portal-main">
        {demo && <div className="demo-banner"><Sparkles size={15} /><span><b>Demonstration workspace</b> — realistic sample data, no customer information.</span><Link href="/login">Supplier sign in <ArrowUpRight size={14} /></Link></div>}
        <div className="page-heading">
          <div><p className="eyebrow">Sunday, 2 August</p><h1>Good afternoon, {data.contactName.split(" ")[0]}.</h1><p>Here’s what needs your attention across {data.companyName}.</p></div>
          <div className="heading-actions"><button className="search-button" aria-label="Search"><Search size={18} /><span>Search</span><kbd>⌘ K</kbd></button><button className="icon-button desktop-only" aria-label="Notifications"><Bell size={19} /><i /></button><span className="avatar">{data.initials}</span></div>
        </div>

        <section className="attention-card">
          <div className="attention-icon"><BriefcaseBusiness size={21} /></div>
          <div><b>{data.stats.newRequests} quote request{data.stats.newRequests === 1 ? " is" : "s are"} waiting for your response</b><p>Respond before each recorded deadline to keep the opportunity active.</p></div>
          <Link href="/dashboard/requests" className="button button-dark">Review requests <ArrowUpRight size={16} /></Link>
        </section>

        <section className="stats-grid" aria-label="Supplier overview">
          <Stat label="New requests" value={String(data.stats.newRequests).padStart(2, "0")} helper="2 added today" icon={<FileText size={19} />} tone="amber" />
          <Stat label="Quotes in progress" value={String(data.stats.openQuotes).padStart(2, "0")} helper="£86.4k total value" icon={<CircleGauge size={19} />} tone="blue" />
          <Stat label="Won this month" value={String(data.stats.wonThisMonth).padStart(2, "0")} helper="£42.8k secured" icon={<Target size={19} />} tone="green" />
          <Stat label="Response rate" value={`${data.stats.responseRate}%`} helper="Up 6% from July" icon={<TrendingUp size={19} />} tone="violet" />
        </section>

        <div className="dashboard-grid">
          <div className="dashboard-primary">
            <section className="panel" id="new-requests">
              <div className="panel-heading"><div><p className="eyebrow">Opportunities</p><h2>New quote requests</h2></div><Link href="/dashboard/requests" className="text-link">View all <ChevronRight size={15} /></Link></div>
              <div className="request-list">
                {data.requests.map((request) => (
                  <article className="request-card" key={request.reference}>
                    <div className="request-top"><div className="request-ref"><span className={`status-dot ${request.urgency}`} />{request.reference}<span className={`tag ${request.status.toLowerCase()}`}>{request.status}</span></div><button className="icon-button subtle" aria-label={`More options for ${request.reference}`}><MoreHorizontal size={18} /></button></div>
                    <h3><Link href={`${requestBase}/${request.reference}`}>{request.title}</Link></h3>
                    <p className="category">{request.category}</p>
                    <div className="request-meta"><span><MapPin size={15} />{request.area}<small>{request.distance}</small></span><span><Paperclip size={15} />{request.attachmentCount} files</span><span><FileCheck2 size={15} />{request.itemCount} items</span></div>
                    <div className="request-footer"><span>Received {request.received}</span><span className={request.urgency === "urgent" ? "due urgent-text" : "due"}><Clock3 size={15} />Respond within <b>{request.due}</b></span><Link href={`${requestBase}/${request.reference}`} className="button button-outline">View request <ArrowUpRight size={15} /></Link></div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel recent-panel">
              <div className="panel-heading"><div><p className="eyebrow">Pipeline</p><h2>Recent quotations</h2></div><Link href="/dashboard/requests?view=submitted" className="text-link">Quotation history <ChevronRight size={15} /></Link></div>
              <div className="table-wrap"><table><thead><tr><th>Request</th><th>Submitted</th><th>Quote value</th><th>Status</th><th /></tr></thead><tbody>{data.recent.map((item) => <tr key={item.reference}><td><b>{item.title}</b><span>{item.reference}</span></td><td>{item.date}</td><td><b>{item.value}</b></td><td><span className={`result ${item.status.toLowerCase()}`}>{item.status}</span></td><td><ChevronRight size={16} /></td></tr>)}</tbody></table></div>
            </section>
          </div>

          <aside className="dashboard-rail">
            <section className="panel scorecard">
              <div className="panel-heading compact"><div><p className="eyebrow">Last 30 days</p><h2>Performance</h2></div><span className="score-badge">Excellent</span></div>
              <div className="score-ring" style={{ "--score": `${data.stats.responseRate * 3.6}deg` } as React.CSSProperties}><div><b>{data.stats.responseRate}</b><span>/100</span><small>Supplier score</small></div></div>
              <div className="performance-list"><div><span>Average response</span><b>{data.performance.responseTime}</b></div><div><span>Quote win rate</span><b>{data.performance.winRate}</b></div><div><span>Won value</span><b>{data.performance.monthValue}</b></div></div>
              <p className="score-note"><CheckCircle2 size={16} />You’re responding 48 minutes faster than similar suppliers.</p>
            </section>

            <section className="panel subscription-card">
              <div className="plan-orbit"><i /><Plus size={18} /></div><p className="eyebrow">{data.subscription.plan} plan</p><h3>Your subscription is {data.subscription.status.toLowerCase()}</h3><p>Unlimited team members and up to 25 qualified requests each month.</p><div className="usage"><span><b>11</b> of 25 requests</span><span>44%</span></div><div className="usage-track"><i /></div><small>Renews {data.subscription.renewal}</small><Link href="/dashboard/subscription" className="text-link">Manage subscription <ArrowUpRight size={14} /></Link>
            </section>

            <section className="help-card"><HelpCircle size={20} /><div><b>Need a hand?</b><p>Your supplier success team usually replies within one working hour.</p><Link href="/help">Contact support</Link></div></section>
          </aside>
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation"><Link href="/dashboard" className="active"><CircleGauge size={20} />Overview</Link><Link href="/dashboard/requests"><FileText size={20} />Requests<i>4</i></Link><Link href="/dashboard/company"><BriefcaseBusiness size={20} />Company</Link><Link href="/dashboard/settings"><MoreHorizontal size={20} />More</Link></nav>
    </div>
  );
}

function Stat({ label, value, helper, icon, tone }: { label: string; value: string; helper: string; icon: React.ReactNode; tone: string }) {
  return <article className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div><p>{label}</p><b>{value}</b><span>{helper}</span></div></article>;
}
