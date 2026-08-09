"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AffiliateRealtimeRefresh({ affiliateId }: { affiliateId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"connecting" | "live" | "recovering">("connecting");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`affiliate:${affiliateId}`);
    const refreshSoon = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 450);
    };
    for (const table of ["affiliate_referrals", "affiliate_commissions", "affiliate_notifications", "affiliate_payouts"]) {
      channel.on("postgres_changes", { event: "*", schema: "bridge_ai", table, filter: `affiliateId=eq.${affiliateId}` }, refreshSoon);
    }
    channel.subscribe((next) => setStatus(next === "SUBSCRIBED" ? "live" : next === "CHANNEL_ERROR" || next === "TIMED_OUT" || next === "CLOSED" ? "recovering" : "connecting"));
    const fallback = window.setInterval(() => router.refresh(), 60_000);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      window.clearInterval(fallback);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      void supabase.removeChannel(channel);
    };
  }, [affiliateId, router]);
  return <div className={`affiliate-live-pill is-${status}`} aria-live="polite"><i />{status === "live" ? "Live data" : status === "recovering" ? "Reconnecting" : "Connecting"}</div>;
}
