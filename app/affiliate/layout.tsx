import { requireAffiliatePage } from "@/lib/auth/guards";
import { AffiliateShell } from "@/components/affiliate/affiliate-shell";

export const dynamic = "force-dynamic";

export default async function AffiliateLayout({ children }: { children: React.ReactNode }) {
  const { affiliate } = await requireAffiliatePage();
  return <AffiliateShell name={affiliate.displayName} affiliateId={affiliate.id}>{children}</AffiliateShell>;
}
