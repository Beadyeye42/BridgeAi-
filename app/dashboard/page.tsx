import { redirect } from "next/navigation";
import { SupplierDashboard } from "@/components/dashboard/supplier-dashboard";
import type { DashboardData } from "@/lib/demo-data";
import {
  getCurrentSession,
  getPrimarySupplierCompanyId,
} from "@/lib/auth/session";
import { getSupplierDashboard } from "@/lib/data/supplier-dashboard";
import { supplierResponseMillisecondsBetween } from "@/lib/quotes/response-clock";
import { supplierOnboardingReadiness } from "@/lib/suppliers/onboarding";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!process.env.POSTGRES_PRISMA_URL) redirect("/");
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role === "ADMINISTRATOR") redirect("/admin");
  const companyId = getPrimarySupplierCompanyId(session);
  if (!companyId) redirect("/account-restricted");
  const dashboard = await getSupplierDashboard(companyId, session.userId);
  const assignmentsByRequest = new Map(
    dashboard.assignments.map((assignment) => [assignment.quoteRequestId, assignment]),
  );

  const data: DashboardData = {
    companyName: dashboard.company.tradingName ?? dashboard.company.legalName,
    contactName: `${session.user.firstName} ${session.user.lastName}`,
    initials: `${session.user.firstName[0] ?? ""}${session.user.lastName[0] ?? ""}`,
    unreadNotificationCount: dashboard.unreadNotificationCount,
    subscription: {
      plan: dashboard.company.subscription?.planCode ?? "Starter",
      status: dashboard.company.subscription?.status ?? "Not started",
      renewal:
        dashboard.company.subscription?.currentPeriodEnd?.toLocaleDateString(
          "en-GB",
          { day: "numeric", month: "short", year: "numeric" },
        ) ?? "—",
    },
    stats: {
      newRequests: dashboard.openOpportunityCount,
      openQuotes: dashboard.metrics.openQuotes,
      wonThisMonth: dashboard.metrics.wonThisMonth,
      responseRate: dashboard.metrics.responseRate,
    },
    performance: {
      responseTime: formatDuration(dashboard.metrics.averageResponseMs),
      winRate: dashboard.metrics.winRate === null ? "—" : `${dashboard.metrics.winRate}%`,
      monthValue: new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(dashboard.metrics.monthValuePence / 100),
    },
    requests: dashboard.opportunities.map((opportunity) => {
      const assignment = assignmentsByRequest.get(opportunity.quoteRequestId);
      return {
        assignmentId: assignment?.id,
        reference: opportunity.reference,
        title: opportunity.title,
        category: opportunity.category.name,
        area: `${opportunity.deliveryArea} area`,
        distance: "Customer details protected",
        received: formatRelative(
          opportunity.publishedAt,
          dashboard.generatedAt.getTime(),
        ),
        due: formatDue(opportunity.responseDueAt, dashboard.generatedAt.getTime()),
        urgency:
          supplierResponseMillisecondsBetween(dashboard.generatedAt, opportunity.responseDueAt) < 8 * 3_600_000
            ? "urgent"
            : "normal",
        itemCount: opportunity.itemCount,
        attachmentCount: opportunity.attachmentCount,
        status:
          !assignment
            ? "Available"
            : assignment.status === "PENDING"
              ? "New"
              : assignment.status === "VIEWED"
                ? "Viewed"
                : "Accepted",
      };
    }),
    recent: dashboard.recentQuotations.map((quotation) => ({
      reference: quotation.quoteRequest.reference,
      title: quotation.quoteRequest.title,
      value: new Intl.NumberFormat("en-GB", { style: "currency", currency: quotation.currency, maximumFractionDigits: 0 }).format(Number(quotation.price)),
      status: quotation.status === "ACCEPTED" ? "Won" : quotation.status === "REJECTED" ? "Lost" : "Submitted",
      date: quotation.submittedAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) ?? "—",
    })),
  };
  return <SupplierDashboard
    data={data}
    onboarding={supplierOnboardingReadiness(dashboard.company)}
    supplierStatus={dashboard.company.status}
  />;
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) return "—";
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatDue(value: Date, now: number) {
  const hours = Math.max(0, Math.round(supplierResponseMillisecondsBetween(new Date(now), value) / 3_600_000));
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

function formatRelative(value: Date, now: number) {
  const hours = Math.max(0, Math.round((now - value.getTime()) / 3_600_000));
  return hours < 1
    ? "just now"
    : hours < 24
      ? `${hours} hours ago`
      : `${Math.round(hours / 24)} days ago`;
}
