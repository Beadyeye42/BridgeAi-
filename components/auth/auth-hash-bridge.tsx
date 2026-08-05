"use client";

import { useEffect } from "react";
import { recoverySessionFromHash } from "@/lib/auth/recovery-hash";
import { createClient } from "@/lib/supabase/client";

export function AuthHashBridge() {
  useEffect(() => {
    const recovery = recoverySessionFromHash(window.location.hash);
    if (!recovery) return;

    let active = true;
    const cleanUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", cleanUrl);

    void createClient().auth.setSession({
      access_token: recovery.accessToken,
      refresh_token: recovery.refreshToken,
    }).then(({ error }) => {
      if (!active) return;
      window.location.replace(error ? "/login?auth=error" : "/reset-password");
    });

    return () => {
      active = false;
    };
  }, []);

  return null;
}
