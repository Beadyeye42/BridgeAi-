"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AffiliateCreateForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
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
    if (!response.ok) {
      setMessageTone("error");
      return setMessage(result.error ?? "Affiliate could not be created.");
    }
    target.reset(); setMessageTone("success"); setMessage("Affiliate invitation sent."); router.refresh();
  }
  return <form className="affiliate-create-form" onSubmit={submit}>
    <div className="affiliate-form-grid">
      <label className="affiliate-form-field" htmlFor="affiliate-first-name"><span>First name</span><input id="affiliate-first-name" name="firstName" autoComplete="given-name" required /></label>
      <label className="affiliate-form-field" htmlFor="affiliate-last-name"><span>Last name</span><input id="affiliate-last-name" name="lastName" autoComplete="family-name" required /></label>
      <label className="affiliate-form-field" htmlFor="affiliate-display-name"><span>Affiliate or business name</span><input id="affiliate-display-name" name="displayName" autoComplete="organization" required /></label>
      <label className="affiliate-form-field" htmlFor="affiliate-email"><span>Business email</span><input id="affiliate-email" name="email" type="email" autoComplete="email" required /></label>
      <label className="affiliate-form-field affiliate-code-field" htmlFor="affiliate-code"><span>Referral code</span><input id="affiliate-code" name="code" required minLength={4} maxLength={24} pattern="[A-Za-z0-9]+" placeholder="AFF123" autoCapitalize="characters" /><small>Use 4–24 letters or numbers. This becomes part of their private referral link.</small></label>
    </div>
    <label className="affiliate-activation-choice">
      <input type="checkbox" name="activate" />
      <span><b>Activate this affiliate immediately</b><small>Leave unticked to create the account as pending. Activating uses one of the ten affiliate places.</small></span>
    </label>
    {message && <p className={`form-alert ${messageTone}`} role="status" aria-live="polite">{message}</p>}
    <div className="affiliate-form-footer">
      <p>A secure invitation email will be sent to the business email above.</p>
      <button className="button button-primary" disabled={busy}>{busy ? "Creating…" : "Create affiliate and send invite"}</button>
    </div>
  </form>;
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
