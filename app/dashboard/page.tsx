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
  if (session.user.role === "AFFILIATE") redirect("/affiliate");
  const companyId = getPrimarySupplierCompanyId(session);
  if (!companyId) redirect("/account-restricted");
  const dashboard = await getSupplierDashboard(companyId, session.userId);
  const latestSelectedQuotation = dashboard.latestSelectedQuotation;
  const formatQuoteValue = (price: { toString(): string }, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(price));
  const data: DashboardData = {
    companyName: dashboard.company.tradingName ?? dashboard.company.legalName,
    contactName: `${session.user.firstName} ${session.user.lastName}`,
    initials: `${session.user.firstName[0] ?? ""}${session.user.lastName[0] ?? ""}`,
    unreadNotificationCount: dashboard.unreadNotificationCount,
    subscription: {
      plan: dashboard.company.subscription?.membershipPlan?.name ?? dashboard.company.subscription?.planCode ?? "Not selected",
      status: dashboard.company.subscription?.status ?? "Not started",
      renewal:
        dashboard.company.subscription?.currentPeriodEnd?.toLocaleDateString(
          "en-GB",
          { day: "numeric", month: "short", year: "numeric" },
        ) ?? "—",
    },
    stats: {
      newRequests: dashboard.openAssignmentCount,
      openQuotes: dashboard.metrics.openQuotes,
      selectedThisMonth: dashboard.metrics.selectedThisMonth,
      confirmedThisMonth: dashboard.metrics.confirmedThisMonth,
      responseRate: dashboard.metrics.responseRate,
    },
    performance: {
      responseTime: formatDuration(dashboard.metrics.averageResponseMs),
      selectionRate: dashboard.metrics.selectionRate === null ? "—" : `${dashboard.metrics.selectionRate}%`,
      confirmationRate: dashboard.metrics.confirmationRate === null ? "—" : `${dashboard.metrics.confirmationRate}%`,
      monthValue: new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(dashboard.metrics.monthValuePence / 100),
    },
    latestSelection: latestSelectedQuotation ? {
      reference: latestSelectedQuotation.quoteRequest.reference,
      title: latestSelectedQuotation.quoteRequest.title,
      value: formatQuoteValue(latestSelectedQuotation.price, latestSelectedQuotation.currency),
      status: latestSelectedQuotation.quoteRequest.status,
    } : undefined,
    upgradeInsight: dashboard.upgradeInsight,
    opportunityAccess: dashboard.opportunityAccess,
    requests: dashboard.assignments.map((assignment) => {
      const quoteRequest = assignment.quoteRequest;
      return {
        assignmentId: assignment.id,
        reference: quoteRequest.reference,
        title: quoteRequest.title,
        category: quoteRequest.category.name,
        area: `${quoteRequest.deliveryPostcode.slice(0, -3)} area`,
        distance: "Customer details protected",
        received: formatRelative(
          assignment.assignedAt,
          dashboard.generatedAt.getTime(),
        ),
        due: formatDue(assignment.expiresAt, dashboard.generatedAt.getTime()),
        urgency:
          supplierResponseMillisecondsBetween(dashboard.generatedAt, assignment.expiresAt) < 8 * 3_600_000
            ? "urgent"
            : "normal",
        itemCount: quoteRequest.items.length,
        attachmentCount: quoteRequest.attachments.length,
        status:
          assignment.status === "PENDING"
              ? "New"
              : assignment.status === "VIEWED"
                ? "Viewed"
                : "Accepted",
      };
    }),
    recent: dashboard.recentQuotations.map((quotation) => ({
      reference: quotation.quoteRequest.reference,
      title: quotation.quoteRequest.title,
      value: formatQuoteValue(quotation.price, quotation.currency),
      status: quotation.status === "ACCEPTED" ? (quotation.quoteRequest.status === "COMPLETED" ? "Completed" : quotation.quoteRequest.status === "CONFIRMED" ? "Confirmed" : "Selected") : quotation.status === "REJECTED" ? "Lost" : "Submitted",
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
