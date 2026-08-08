"use client";
import { useState } from "react";
import { CreditCard, LoaderCircle } from "lucide-react";

export function CheckoutButton({ endpoint, children, body, className = "button button-dark" }: { endpoint: string; children: React.ReactNode; body?: unknown; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json().catch(() => ({} as { error?: string; url?: string }));
      if (!response.ok || !result.url) throw new Error(result.error || "Checkout could not be started");
      window.location.assign(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout could not be started");
      setBusy(false);
    }
  }
  return <div><button type="button" className={className} disabled={busy} onClick={start}>{busy ? <LoaderCircle className="spin" size={15}/> : <CreditCard size={15}/>} {busy ? "Opening secure checkout…" : children}</button>{error && <p className="form-result error">{error}</p>}</div>;
}
