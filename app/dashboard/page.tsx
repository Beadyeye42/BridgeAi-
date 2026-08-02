import { redirect } from "next/navigation";
import { SupplierDashboard } from "@/components/dashboard/supplier-dashboard";
import type { DashboardData } from "@/lib/demo-data";
import { getCurrentSession, getPrimarySupplierCompanyId } from "@/lib/auth/session";
import { getSupplierDashboard } from "@/lib/data/supplier-dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!process.env.POSTGRES_PRISMA_URL) redirect("/");
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role === "ADMINISTRATOR") redirect("/admin");
  const companyId = getPrimarySupplierCompanyId(session);
  if (!companyId) redirect("/register");
  const dashboard = await getSupplierDashboard(companyId);

  const data: DashboardData = {
    companyName: dashboard.company.tradingName ?? dashboard.company.legalName,
    contactName: `${session.user.firstName} ${session.user.lastName}`,
    initials: `${session.user.firstName[0] ?? ""}${session.user.lastName[0] ?? ""}`,
    subscription: {
      plan: dashboard.company.subscription?.planCode ?? "Starter",
      status: dashboard.company.subscription?.status ?? "Trialing",
      renewal: dashboard.company.subscription?.currentPeriodEnd?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) ?? "—",
    },
    stats: { newRequests: dashboard.assignments.filter((item) => item.status === "PENDING").length, openQuotes: dashboard.submittedCount, wonThisMonth: dashboard.wonCount, responseRate: dashboard.submittedCount ? Math.round((dashboard.submittedCount / Math.max(dashboard.assignments.length + dashboard.submittedCount, 1)) * 100) : 0 },
    performance: { responseTime: "—", winRate: dashboard.submittedCount ? `${Math.round((dashboard.wonCount / dashboard.submittedCount) * 100)}%` : "—", monthValue: "—" },
    requests: dashboard.assignments.map((assignment) => ({
      assignmentId: assignment.id,
      reference: assignment.quoteRequest.reference,
      title: assignment.quoteRequest.title,
      category: assignment.quoteRequest.category.name,
      area: assignment.quoteRequest.deliveryPostcode,
      distance: "Within coverage",
      received: formatRelative(assignment.assignedAt, dashboard.generatedAt.getTime()),
      due: formatDue(assignment.expiresAt, dashboard.generatedAt.getTime()),
      urgency: assignment.expiresAt.getTime() - dashboard.generatedAt.getTime() < 8 * 3_600_000 ? "urgent" : "normal",
      itemCount: assignment.quoteRequest.items.length,
      attachmentCount: assignment.quoteRequest.attachments.length,
      status: assignment.status === "PENDING" ? "New" : assignment.status === "VIEWED" ? "Viewed" : "Accepted",
    })),
    recent: [],
  };
  return <SupplierDashboard data={data} />;
}

function formatDue(value: Date, now: number) {
  const hours = Math.max(0, Math.round((value.getTime() - now) / 3_600_000));
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

function formatRelative(value: Date, now: number) {
  const hours = Math.max(0, Math.round((now - value.getTime()) / 3_600_000));
  return hours < 1 ? "just now" : hours < 24 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`;
}
