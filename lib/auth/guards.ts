import { redirect } from "next/navigation";
import { cache } from "react";
import {
  getCurrentSession,
  getPrimarySupplierCompanyId,
} from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";

export const requireSupplierPage = cache(async function requireSupplierPage() {
  if (!process.env.POSTGRES_PRISMA_URL) redirect("/");
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role === "ADMINISTRATOR") redirect("/admin");
  if (session.user.role === "AFFILIATE") redirect("/affiliate");
  const companyId = getPrimarySupplierCompanyId(session);
  if (!companyId) redirect("/account-restricted");
  const company = session.user.memberships.find(
    (item) => item.supplierCompanyId === companyId,
  )?.supplierCompany;
  if (company && ["SUSPENDED", "REJECTED"].includes(company.status))
    redirect("/account-restricted");
  return { session, companyId };
});

export const requireAdminPage = cache(async function requireAdminPage() {
  if (!process.env.POSTGRES_PRISMA_URL) redirect("/");
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role !== "ADMINISTRATOR") redirect(session.user.role === "AFFILIATE" ? "/affiliate" : "/dashboard");
  await writeAuditLog({
    actorUserId: session.userId,
    action: "ADMIN.PORTAL_ACCESS",
    entityType: "PlatformAdministrator",
    entityId: session.userId,
    summary: "Administrator portal access verified",
  });
  return session;
});

export const requireAffiliatePage = cache(async function requireAffiliatePage() {
  if (!process.env.POSTGRES_PRISMA_URL) redirect("/");
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role === "ADMINISTRATOR") redirect("/admin");
  if (session.user.role !== "AFFILIATE" || !session.user.affiliate) redirect("/dashboard");
  return { session, affiliate: session.user.affiliate };
});
