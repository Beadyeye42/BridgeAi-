"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BRAND_NAME } from "@/lib/brand";

export function BuyerAuthVerifier() {
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const challenge = fragment.get("challenge") ?? "";
    const tokenHash = fragment.get("token_hash") ?? "";
    const type = fragment.get("type") ?? "";

    // Remove the bearer data before any further navigation, analytics or
    // resource request can observe it. Fragments never reach the server.
    window.history.replaceState(null, "", window.location.pathname);

    void fetch("/api/buyer/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge, tokenHash, type }),
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json().catch(() => null) as { next?: string } | null;
        if (!response.ok || !result?.next?.startsWith("/buyer")) throw new Error("INVALID_LINK");
        window.location.replace(result.next);
      })
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="buyer-auth-page">
      <section className="buyer-auth-story">
        <Link href="/" className="buyer-wordmark">{BRAND_NAME}</Link>
        <p className="eyebrow">WhatsApp first. Buyer Hub for control.</p>
        <h1>Your requests stay private and connected.</h1>
        <p>One secure identity links the WhatsApp conversation you already know with the Buyer Hub controls you need.</p>
        <ul><li>One-time access link</li><li>Trusted device for up to 30 days</li><li>Supplier details protected until selection</li></ul>
      </section>
      <section className="buyer-auth-panel" aria-live="polite">
        <div>
          <span className="eyebrow">Secure buyer access</span>
          <h2>{failed ? "This link could not sign you in" : "Signing you in securely"}</h2>
          <p>
            {failed
              ? "The link may have expired or already been used. Request a fresh WhatsApp sign-in link."
              : `${BRAND_NAME} is verifying your one-time link and trusted device.`}
          </p>
          {failed ? <Link className="button button-primary" href="/buyer/login">Request another link</Link> : <p className="buyer-login-message">Please wait a moment. You will be redirected automatically.</p>}
        </div>
      </section>
    </main>
  );
}
