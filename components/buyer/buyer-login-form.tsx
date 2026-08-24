"use client";

import { useState } from "react";

export function BuyerLoginForm({ next }: { next: string }) {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setMessage("");
    try {
      const response = await fetch("/api/buyer/auth/request-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, next }),
      });
      const body = await response.json() as { message?: string };
      setMessage(body.message ?? "If your number is linked, a secure sign-in link will arrive shortly.");
    } catch {
      setMessage("If your number is linked, a secure sign-in link will arrive shortly.");
    } finally {
      setSending(false);
    }
  }

  return <form onSubmit={submit} className="buyer-login-form">
    <label htmlFor="buyer-phone">WhatsApp number</label>
    <input
      id="buyer-phone"
      name="phone"
      type="tel"
      autoComplete="tel"
      inputMode="tel"
      placeholder="07700 900000"
      value={phone}
      onChange={(event) => setPhone(event.target.value)}
      required
      maxLength={40}
    />
    <button type="submit" disabled={sending}>{sending ? "Sending securely…" : "Send sign-in link on WhatsApp"}</button>
    {message ? <p className="buyer-login-message" role="status">{message}</p> : null}
  </form>;
}
