import { BuyerShell } from "@/components/buyer/buyer-shell";
import { getBuyerProfile } from "@/lib/buyer/data";

export const dynamic = "force-dynamic";

export default async function BuyerHubLayout({ children }: { children: React.ReactNode }) {
  const profile = await getBuyerProfile();
  return <BuyerShell buyerId={profile.id} firstName={profile.firstName}>{children}</BuyerShell>;
}
