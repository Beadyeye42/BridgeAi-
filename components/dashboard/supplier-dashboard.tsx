import Link from "next/link";
import { ArrowUpRight, Bell, BriefcaseBusiness, CheckCircle2, ChevronRight, CircleGauge, Clock3, FileCheck2, FileText, HelpCircle, MapPin, MoreHorizontal, Paperclip, Plus, Search, Sparkles, Target, TrendingUp } from "lucide-react";
import type { DashboardData } from "@/lib/demo-data";
import { Sidebar } from "./sidebar";
import { BrandMark } from "@/components/brand-mark";
import type { SupplierOnboardingReadiness } from "@/lib/suppliers/onboarding";
import { OnboardingReadiness as OnboardingReadinessCard } from "./onboarding-readiness";
import { RefreshButton } from "./refresh-button";

export function SupplierDashboard({ data, demo = false, onboarding, supplierStatus = "APPROVED" }: { data: DashboardData; demo?: boolean; onboarding?: SupplierOnboardingReadiness; supplierStatus?: string }) {
  const requestBase = demo ? "/requests" : "/dashboard/requests";
  return (
    <div className="portal-shell">
      <Sidebar companyName={data.companyName} initials={data.initials} companyStatus={supplierStatus} activeRequestCount={data.stats.newRequests} unreadNotificationCount={data.unreadNotificationCount} />
      <header className="mobile-header"><BrandMark compact /><span>{data.companyName}</span><div className="mobile-header-actions"><RefreshButton compact/><Link href="/dashboard/notifications" className="icon-button" aria-label="Notifications"><Bell size={19} /></Link></div></header>
      <main className="portal-main">
        {demo && <div className="demo-banner"><Sparkles size={15} /><span><b>Demonstration workspace</b> — realistic sample data, no customer information.</span><Link href="/login">Supplier sign in <ArrowUpRight size={14} /></Link></div>}
        <div className="page-heading">
          <div><p className="eyebrow">{demo ? "Sunday, 2 August" : new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p><h1>Good afternoon, {data.contactName.split(" ")[0]}.</h1><p>Here’s what needs your attention across {data.companyName}.</p></div>
          <div className="heading-actions"><button className="search-button" aria-label="Search"><Search size={18} /><span>Search</span><kbd>⌘ K</kbd></button><RefreshButton/><Link href="/dashboard/notifications" className="icon-button desktop-only" aria-label="Notifications"><Bell size={19} />{data.unreadNotificationCount > 0 && <i />}</Link><span className="avatar">{data.initials}</span></div>
        </div>

        {onboarding && (!onboarding.ready || supplierStatus !== "APPROVED")
          ? <OnboardingReadinessCard readiness={onboarding} status={supplierStatus} purpose="matching" />
          : null}

        {data.stats.newRequests > 0 ? <section className="attention-card">
          <div className="attention-icon"><BriefcaseBusiness size={21} /></div>
          <div><b>{data.stats.newRequests} matched quote request{data.stats.newRequests === 1 ? " is" : "s are"} waiting</b><p>These requests were selected for your company from its confirmed capabilities, coverage and current capacity.</p></div>
          <Link href="/dashboard/requests" className="button button-dark">View leads <ArrowUpRight size={16} /></Link>
        </section> : null}

        <section className="stats-grid" aria-label="Supplier overview">
          <Stat label="Matched leads" value={String(data.stats.newRequests).padStart(2, "0")} helper={demo ? "2 added today" : "Assigned to your company"} icon={<FileText size={19} />} tone="amber" />
          <Stat label="Quotes in progress" value={String(data.stats.openQuotes).padStart(2, "0")} helper={demo ? "£86.4k total value" : "Submitted and awaiting a decision"} icon={<CircleGauge size={19} />} tone="blue" />
          <Stat label="Won this month" value={String(data.stats.wonThisMonth).padStart(2, "0")} helper={demo ? "£42.8k secured" : data.performance.monthValue === "£0" ? "No wins recorded yet" : `${data.performance.monthValue} secured`} icon={<Target size={19} />} tone="green" />
          <Stat label="Response rate" value={`${data.stats.responseRate}%`} helper={demo ? "Up 6% from July" : "Assigned requests answered in 30 days"} icon={<TrendingUp size={19} />} tone="violet" />
        </section>

        <div className="dashboard-grid">
          <div className="dashboard-primary">
            <section className="panel" id="new-requests">
              <div className="panel-heading"><div><p className="eyebrow">Matched opportunities</p><h2>Requests selected for you</h2></div><Link href="/dashboard/requests" className="text-link">View all <ChevronRight size={15} /></Link></div>
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
              <div className="panel-heading compact"><div><p className="eyebrow">Last 30 days</p><h2>Performance</h2></div><span className="score-badge">{scoreLabel(data.stats.responseRate)}</span></div>
              <div className="score-ring" style={{ "--score": `${data.stats.responseRate * 3.6}deg` } as React.CSSProperties}><div><b>{data.stats.responseRate}</b><span>/100</span><small>Supplier score</small></div></div>
              <div className="performance-list"><div><span>Average response</span><b>{data.performance.responseTime}</b></div><div><span>Quote win rate</span><b>{data.performance.winRate}</b></div><div><span>Won value</span><b>{data.performance.monthValue}</b></div></div>
              <p className="score-note"><CheckCircle2 size={16} />{demo ? "You’re responding 48 minutes faster than similar suppliers." : "Based on recorded assignments and submitted quotations."}</p>
            </section>

            <section className="panel subscription-card">
              <div className="plan-orbit"><i /><Plus size={18} /></div><p className="eyebrow">{data.subscription.plan} plan</p><h3>Your subscription is {data.subscription.status.toLowerCase()}</h3><p>{demo ? "Unlimited team members and up to 25 qualified requests each month." : "Your live billing status and renewal date are shown here."}</p>{demo ? <><div className="usage"><span><b>11</b> of 25 requests</span><span>44%</span></div><div className="usage-track"><i /></div></> : null}<small>{data.subscription.renewal === "—" ? "No renewal date recorded" : `Renews ${data.subscription.renewal}`}</small><Link href="/dashboard/subscription" className="text-link">Manage subscription <ArrowUpRight size={14} /></Link>
            </section>

            <section className="help-card"><HelpCircle size={20} /><div><b>Need a hand?</b><p>Your supplier success team usually replies within one working hour.</p><Link href="/help">Contact support</Link></div></section>
          </aside>
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation"><Link href="/dashboard" className="active"><CircleGauge size={20} />Overview</Link><Link href="/dashboard/requests"><FileText size={20} />Requests{data.stats.newRequests > 0 && <i>{data.stats.newRequests}</i>}</Link><Link href="/dashboard/company"><BriefcaseBusiness size={20} />Company</Link><Link href="/dashboard/settings"><MoreHorizontal size={20} />More</Link></nav>
    </div>
  );
}

function scoreLabel(score: number) {
  if (score === 0) return "No score yet";
  if (score >= 90) return "Excellent";
  if (score >= 70) return "Good";
  return "Needs attention";
}

function Stat({ label, value, helper, icon, tone }: { label: string; value: string; helper: string; icon: React.ReactNode; tone: string }) {
  return <article className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div><p>{label}</p><b>{value}</b><span>{helper}</span></div></article>;
}
