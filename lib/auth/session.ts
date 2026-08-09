import { cache } from "react";
import { prisma, runWithDatabaseIdentity } from "@/lib/db";
import { getVerifiedAuthUser } from "@/lib/supabase/verified-user";

export const getCurrentSession = cache(async () => {
  const authUser = await getVerifiedAuthUser();
  if (!authUser) return null;

  const profile = await runWithDatabaseIdentity(authUser.id, () =>
    prisma.user.findUnique({
      where: { id: authUser.id },
      include: {
        platformAdministrator: true,
        affiliate: true,
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
  const isAffiliate = profile.affiliate?.status === "ACTIVE";
  return {
    userId: authUser.id,
    accessToken: null,
    expiresAt: null,
    user: {
      ...profile,
      role: isAdministrator ? ("ADMINISTRATOR" as const) : isAffiliate ? ("AFFILIATE" as const) : ("SUPPLIER" as const),
    },
  };
});

export function getPrimarySupplierCompanyId(
  session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>,
) {
  return session.user.memberships[0]?.supplierCompanyId ?? null;
}
