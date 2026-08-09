"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      window.location.assign("/login");
    } catch {
      setBusy(false);
    }
  }

  return <button
    aria-label={busy ? "Signing out" : "Sign out"}
    className={compact ? "icon-button" : "sidebar-link sidebar-logout"}
    title={busy ? "Signing out…" : "Sign out"}
    type="button"
    disabled={busy}
    onClick={logout}
  ><LogOut size={18} />{compact ? null : busy ? "Signing out…" : "Sign out"}</button>;
}
