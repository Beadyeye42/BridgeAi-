"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AffiliateRealtimeRefresh({ affiliateId }: { affiliateId: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`affiliate:${affiliateId}`);
    for (const table of ["affiliate_referrals", "affiliate_commissions", "affiliate_notifications", "affiliate_payouts"]) {
      channel.on("postgres_changes", { event: "*", schema: "bridge_ai", table, filter: `affiliateId=eq.${affiliateId}` }, () => router.refresh());
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [affiliateId, router]);
  return null;
}
