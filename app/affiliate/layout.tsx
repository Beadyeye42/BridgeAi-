import { requireAffiliatePage } from "@/lib/auth/guards";
import { AffiliateShell } from "@/components/affiliate/affiliate-shell";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AffiliateLayout({ children }: { children: React.ReactNode }) {
  const { affiliate } = await requireAffiliatePage();
  const navigation = await prisma.$transaction(async (tx) => {
    const programme = await tx.affiliateProgramme.findUniqueOrThrow({ where: { id: "default" }, select: { maximumActive: true } });
    const unreadNotifications = await tx.affiliateNotification.count({ where: { affiliateId: affiliate.id, readAt: null } });
    return { programme, unreadNotifications };
  });
  return <AffiliateShell name={affiliate.displayName} affiliateId={affiliate.id} maximumActive={navigation.programme.maximumActive} unreadNotifications={navigation.unreadNotifications}>{children}</AffiliateShell>;
}
