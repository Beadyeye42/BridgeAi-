import { redirect } from "next/navigation";
import { cache } from "react";
import {
  getCurrentSession,
  getPrimarySupplierCompanyId,
} from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";

export async function requireSupplierPage() {
  if (!process.env.POSTGRES_PRISMA_URL) redirect("/");
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role === "ADMINISTRATOR") redirect("/admin");
  const companyId = getPrimarySupplierCompanyId(session);
  if (!companyId) redirect("/account-restricted");
  const company = session.user.memberships.find(
    (item) => item.supplierCompanyId === companyId,
  )?.supplierCompany;
  if (company && ["SUSPENDED", "REJECTED"].includes(company.status))
    redirect("/account-restricted");
  return { session, companyId };
}

export const requireAdminPage = cache(async function requireAdminPage() {
  if (!process.env.POSTGRES_PRISMA_URL) redirect("/");
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role !== "ADMINISTRATOR") redirect("/dashboard");
  await writeAuditLog({
    actorUserId: session.userId,
    action: "ADMIN.PORTAL_ACCESS",
    entityType: "PlatformAdministrator",
    entityId: session.userId,
    summary: "Administrator portal access verified",
  });
  return session;
});
