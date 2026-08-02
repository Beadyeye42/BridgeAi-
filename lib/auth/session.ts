import { prisma, runWithDatabaseIdentity } from "@/lib/db";
import { createClient } from "@/lib/supabase/auth-server";

export async function getCurrentSession() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const authUser = data.user;
  if (error || !authUser || !authUser.email_confirmed_at) return null;

  const profile = await runWithDatabaseIdentity(authUser.id, () =>
    prisma.user.findUnique({
      where: { id: authUser.id },
      include: {
        platformAdministrator: true,
        memberships: {
          where: { status: "ACTIVE" },
          include: { supplierCompany: true },
          orderBy: [{ isPrimary: "desc" }, { joinedAt: "asc" }],
        },
      },
    }),
  );
  if (!profile || profile.status !== "ACTIVE") return null;

  const isAdministrator = Boolean(profile.platformAdministrator?.active);
  return {
    userId: authUser.id,
    accessToken: null,
    expiresAt: null,
    user: {
      ...profile,
      role: isAdministrator ? ("ADMINISTRATOR" as const) : ("SUPPLIER" as const),
    },
  };
}

export function getPrimarySupplierCompanyId(
  session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>,
) {
  return session.user.memberships[0]?.supplierCompanyId ?? null;
}
