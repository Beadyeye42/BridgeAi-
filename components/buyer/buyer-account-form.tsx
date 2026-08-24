"use client";

import { useState } from "react";

export function BuyerAccountForm({ initial }: { initial: { companyName: string; postcode: string; buyerType: string; whatsappUpdates: boolean; emailUpdates: boolean } }) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/buyer/account", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({
      companyName: String(form.get("companyName") ?? ""), postcode: String(form.get("postcode") ?? ""), buyerType: String(form.get("buyerType") ?? "CONSUMER"),
      whatsappUpdates: form.get("whatsappUpdates") === "on", emailUpdates: form.get("emailUpdates") === "on",
    }) });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setSaving(false); setMessage(response.ok ? "Account preferences saved." : body.error ?? "Changes could not be saved.");
  }
  return <form className="buyer-account-form" onSubmit={submit}>
    <label>Company name (optional)<input name="companyName" defaultValue={initial.companyName} maxLength={160} /></label>
    <label>Default postcode<input name="postcode" defaultValue={initial.postcode} maxLength={12} autoCapitalize="characters" /></label>
    <label>Buyer type<select name="buyerType" defaultValue={initial.buyerType}><option value="CONSUMER">Consumer / homeowner</option><option value="TRADE">Trade buyer</option><option value="BUSINESS">Business</option></select></label>
    <label className="buyer-check"><input type="checkbox" name="whatsappUpdates" defaultChecked={initial.whatsappUpdates} /> WhatsApp order and quote updates</label>
    <label className="buyer-check"><input type="checkbox" name="emailUpdates" defaultChecked={initial.emailUpdates} /> Email updates (only after email verification)</label>
    <button disabled={saving}>{saving ? "Saving…" : "Save preferences"}</button>
    {message ? <p role="status">{message}</p> : null}
  </form>;
}
