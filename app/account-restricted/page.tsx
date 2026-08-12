import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import {
  getCurrentSession,
  getPrimarySupplierCompanyId,
} from "@/lib/auth/session";

export default async function AccountRestrictedPage() {
  const session = await getCurrentSession();
  if (session?.user.role === "ADMINISTRATOR") redirect("/admin");
  if (session?.user.role === "AFFILIATE") redirect("/affiliate");
  if (session) {
    const companyId = getPrimarySupplierCompanyId(session);
    const company = session.user.memberships.find(
      (membership) => membership.supplierCompanyId === companyId,
    )?.supplierCompany;
    if (company && !["SUSPENDED", "REJECTED"].includes(company.status)) {
      redirect("/dashboard");
    }
  }

  return <AuthShell title="Workspace access restricted" description="This supplier company is suspended or no longer approved. Quote requests and company data are unavailable until a Bridge-iT administrator restores access."><div className="auth-shield"><ShieldAlert size={20}/></div><p className="honesty-note">Contact your Bridge-iT supplier success representative if you believe this is an error.</p><Link href="/login" className="button button-dark auth-submit">Return to sign in</Link></AuthShell>;
}
