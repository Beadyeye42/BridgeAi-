"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

export function LogoutButton() {
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

  return <button className="sidebar-link sidebar-logout" type="button" disabled={busy} onClick={logout}><LogOut size={18} />{busy ? "Signing out…" : "Sign out"}</button>;
}
