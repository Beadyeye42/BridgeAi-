import { requireAdminPage } from "@/lib/auth/guards";
import { AdminShell } from "@/components/admin/admin-shell";
export const dynamic="force-dynamic";
export default async function AdminLayout({children}:{children:React.ReactNode}){const session=await requireAdminPage();return <AdminShell name={`${session.user.firstName} ${session.user.lastName}`}>{children}</AdminShell>}
