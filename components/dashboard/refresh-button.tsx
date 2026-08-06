"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

export function RefreshButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  return <button
    type="button"
    className={compact ? "icon-button" : "button button-secondary refresh-button"}
    aria-label={refreshing ? "Refreshing page" : "Refresh page"}
    title="Refresh page"
    disabled={refreshing}
    onClick={() => startRefresh(() => router.refresh())}
  >
    <RefreshCw className={refreshing ? "spin" : undefined} size={compact ? 18 : 15}/>
    {!compact && <span>{refreshing ? "Refreshing…" : "Refresh"}</span>}
  </button>;
}
