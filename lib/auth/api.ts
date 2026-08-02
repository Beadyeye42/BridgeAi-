import { NextResponse } from "next/server";
import { getCurrentSession, getPrimarySupplierCompanyId } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";

export async function requireSupplierApi() {
  const session = await getCurrentSession();
  if (!session || session.user.role !== "SUPPLIER") return { error: NextResponse.json({ error: "Sign in required" }, { status: 401 }) } as const;
  const companyId = getPrimarySupplierCompanyId(session);
  if (!companyId) return { error: NextResponse.json({ error: "No supplier company membership" }, { status: 403 }) } as const;
  const membership = session.user.memberships.find((item) => item.supplierCompanyId === companyId);
  if (!membership || membership.status !== "ACTIVE") return { error: NextResponse.json({ error: "Active supplier membership required" }, { status: 403 }) } as const;
  const company = membership.supplierCompany;
  if (company && ["SUSPENDED", "REJECTED"].includes(company.status)) return { error: NextResponse.json({ error: "This supplier workspace is restricted" }, { status: 403 }) } as const;
  return { session, companyId } as const;
}

export async function requireAdminApi() {
  const session = await getCurrentSession();
  if (!session) return { error: NextResponse.json({ error: "Sign in required" }, { status: 401 }) } as const;
  if (session.user.role !== "ADMINISTRATOR") return { error: NextResponse.json({ error: "Administrator access required" }, { status: 403 }) } as const;
  await writeAuditLog({ actorUserId: session.userId, action: "ADMIN.API_ACCESS", entityType: "PlatformAdministrator", entityId: session.userId, summary: "Administrator API authorization verified" });
  return { session } as const;
}
