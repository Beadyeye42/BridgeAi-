"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, LoaderCircle, Save } from "lucide-react";

type AffiliateProgrammeValues = {
  maximumActive: number;
  commissionRateBps: number;
  qualificationPayments: number;
  commissionPayments: number;
  validationDays: number;
};

async function saveAffiliateControl(url: string, body: unknown) {
  const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "The affiliate controls could not be saved.");
  return result;
}

export function AffiliateProgrammeControl({ programme }: { programme: AffiliateProgrammeValues }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await saveAffiliateControl("/api/admin/affiliates/programme", {
        maximumActive: Number(form.get("maximumActive")),
        commissionRateBps: Math.round(Number(form.get("commissionRate")) * 100),
        qualificationPayments: Number(form.get("qualificationPayments")),
        commissionPayments: Number(form.get("commissionPayments")),
        validationDays: Number(form.get("validationDays")),
      });
      setMessage("Affiliate programme controls saved."); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed."); }
    finally { setBusy(false); }
  }
  return <form className="panel form-section affiliate-control-panel" onSubmit={submit}>
    <div className="section-heading"><div><p className="eyebrow">Programme control</p><h2>Affiliate rules</h2><p className="body-copy">Control the limited-place programme and the invoice-ledger commission rules. Existing ledger entries never change retrospectively.</p></div></div>
    <div className="form-grid">
      <label className="form-control"><span>Maximum active affiliates</span><input name="maximumActive" type="number" min="1" max="100" defaultValue={programme.maximumActive} required/><small>Cannot be set below the number already active.</small></label>
      <label className="form-control"><span>Default commission rate (%)</span><input name="commissionRate" type="number" min="0" max="100" step="0.01" defaultValue={(programme.commissionRateBps / 100).toFixed(2)} required/><small>Applied to future eligible invoice ledger entries.</small></label>
      <label className="form-control"><span>Qualification payments</span><input name="qualificationPayments" type="number" min="0" max="24" defaultValue={programme.qualificationPayments} required/><small>Successful invoices required before commission begins.</small></label>
      <label className="form-control"><span>Commissionable payments</span><input name="commissionPayments" type="number" min="1" max="60" defaultValue={programme.commissionPayments} required/><small>Maximum eligible paid billing periods per referral.</small></label>
      <label className="form-control"><span>Validation period (days)</span><input name="validationDays" type="number" min="0" max="180" defaultValue={programme.validationDays} required/><small>Commission remains pending during the refund and dispute window.</small></label>
    </div>
    {(message || error) && <p className={`form-result ${error ? "error" : "success"}`} role="status" aria-live="polite">{!error && <CheckCircle2 size={14}/>} {error || message}</p>}
    <button className="button button-dark" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>} Save affiliate rules</button>
  </form>;
}

export function AffiliateProfileControl({ affiliate, defaultCommissionRateBps }: { affiliate: { id: string; displayName: string; code: string; commissionRateBps: number | null }; defaultCommissionRateBps: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); setError("");
    const form = new FormData(event.currentTarget);
    const override = String(form.get("commissionRate") ?? "").trim();
    try {
      await saveAffiliateControl(`/api/admin/affiliates/${affiliate.id}`, {
        displayName: form.get("displayName"),
        code: form.get("code"),
        commissionRateBps: override ? Math.round(Number(override) * 100) : null,
      });
      setMessage("Affiliate controls saved."); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed."); }
    finally { setBusy(false); }
  }
  return <form className="panel form-section affiliate-control-panel" onSubmit={submit}>
    <div className="section-heading"><div><p className="eyebrow">Administrator control</p><h2>Identity and commission</h2><p className="body-copy">Changing the referral code only affects future shared links. Existing referrals and invoice ledger entries remain permanently attributed.</p></div></div>
    <div className="form-grid">
      <label className="form-control"><span>Affiliate or business name</span><input name="displayName" defaultValue={affiliate.displayName} minLength={2} maxLength={120} required/></label>
      <label className="form-control"><span>Referral code</span><input name="code" defaultValue={affiliate.code} minLength={4} maxLength={24} pattern="[A-Za-z0-9]+" required/><small>Use 4–24 letters or numbers.</small></label>
      <label className="form-control span-2"><span>Commission override (%)</span><input name="commissionRate" type="number" min="0" max="100" step="0.01" defaultValue={affiliate.commissionRateBps === null ? "" : (affiliate.commissionRateBps / 100).toFixed(2)} placeholder={`Use programme default (${(defaultCommissionRateBps / 100).toFixed(2)}%)`}/><small>Leave blank to use the programme default. Changes apply only to future eligible invoice ledger entries.</small></label>
    </div>
    {(message || error) && <p className={`form-result ${error ? "error" : "success"}`} role="status" aria-live="polite">{!error && <CheckCircle2 size={14}/>} {error || message}</p>}
    <button className="button button-dark" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>} Save affiliate controls</button>
  </form>;
}

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
    target.reset(); setMessageTone("success"); setMessage("Affiliate invitation accepted for delivery by Resend."); router.refresh();
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

export function AffiliateInvitationControl({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"success" | "error">("success");
  async function resend() {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/admin/affiliates/${id}/resend-invitation`, { method: "POST" });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    setTone(response.ok ? "success" : "error");
    setMessage(response.ok ? "Invitation accepted for delivery." : result.error ?? "Invitation could not be sent.");
  }
  return <div>
    <button className="button button-outline" type="button" disabled={busy} onClick={() => void resend()}>{busy ? "Sending…" : "Resend invitation"}</button>
    {message && <small className={tone === "error" ? "error-text" : "success-text"} role="status" aria-live="polite">{message}</small>}
  </div>;
}

export function AffiliatePayoutControls({ affiliateId, scheduled }: { affiliateId: string; scheduled: Array<{ id: string; reference: string }> }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function act(payload: Record<string, string>) {
    setBusy(true); setMessage(""); const response = await fetch("/api/admin/affiliates/payouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const result = await response.json().catch(() => ({})); setBusy(false); setMessage(response.ok ? "Payout records updated." : result.error ?? "Payout operation failed."); if (response.ok) router.refresh();
  }
  return <div className="settings-form"><button className="button button-primary" disabled={busy} onClick={() => void act({ action: "generate", affiliateId })}>Generate payout statement</button>{scheduled.map((payout) => <button className="button button-outline" disabled={busy} key={payout.id} onClick={() => { const reference = window.prompt("Bank transfer or payment reference"); if (reference) void act({ action: "mark_paid", payoutId: payout.id, paymentReference: reference }); }}>Mark {payout.reference} paid</button>)}{message && <small>{message}</small>}</div>;
}
