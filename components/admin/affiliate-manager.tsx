"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AffiliateCreateForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const target = event.currentTarget;
    const form = new FormData(target);
    const payload = Object.fromEntries(form.entries()) as Record<string, unknown>;
    payload.activate = form.get("activate") === "on";
    const response = await fetch("/api/admin/affiliates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setMessage(result.error ?? "Affiliate could not be created.");
    target.reset(); setMessage("Affiliate invitation sent."); router.refresh();
  }
  return <form className="settings-form" onSubmit={submit}><div className="field-row"><label>First name<input name="firstName" required /></label><label>Last name<input name="lastName" required /></label></div><div className="field-row"><label>Display name<input name="displayName" required /></label><label>Business email<input name="email" type="email" required /></label></div><label>Referral code<input name="code" required minLength={4} maxLength={24} pattern="[A-Za-z0-9]+" placeholder="AFF123" /></label><label className="check-field"><input type="checkbox" name="activate" /><span>Activate immediately (counts toward the 10-place limit)</span></label>{message && <p className="form-alert" role="status">{message}</p>}<button className="button button-primary" disabled={busy}>{busy ? "Creating…" : "Create affiliate and send invite"}</button></form>;
}

export function AffiliateStatusControl({ id, status }: { id: string; status: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function update(next: string) {
    const reason = next === "SUSPENDED" ? window.prompt("Reason for suspension (required)") : undefined;
    if (next === "SUSPENDED" && !reason) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/admin/affiliates/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next, reason }) });
    const result = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) return setError(result.error ?? "Update failed");
    router.refresh();
  }
  return <div><select aria-label="Affiliate status" value={status} disabled={busy} onChange={(event) => void update(event.target.value)}>{["PENDING","ACTIVE","SUSPENDED","REJECTED"].map((option) => <option key={option}>{option}</option>)}</select>{error && <small className="error-text">{error}</small>}</div>;
}

export function AffiliatePayoutControls({ affiliateId, scheduled }: { affiliateId: string; scheduled: Array<{ id: string; reference: string }> }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function act(payload: Record<string, string>) {
    setBusy(true); setMessage(""); const response = await fetch("/api/admin/affiliates/payouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const result = await response.json().catch(() => ({})); setBusy(false); setMessage(response.ok ? "Payout records updated." : result.error ?? "Payout operation failed."); if (response.ok) router.refresh();
  }
  return <div className="settings-form"><button className="button button-primary" disabled={busy} onClick={() => void act({ action: "generate", affiliateId })}>Generate payout statement</button>{scheduled.map((payout) => <button className="button button-outline" disabled={busy} key={payout.id} onClick={() => { const reference = window.prompt("Bank transfer or payment reference"); if (reference) void act({ action: "mark_paid", payoutId: payout.id, paymentReference: reference }); }}>Mark {payout.reference} paid</button>)}{message && <small>{message}</small>}</div>;
}
