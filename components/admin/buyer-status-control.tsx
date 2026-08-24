"use client";

import { useState } from "react";

export function BuyerStatusControl({ id, status }: { id: string; status: "ACTIVE" | "SUSPENDED" }) {
  const [current, setCurrent] = useState(status);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function update() {
    const next = current === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/buyers/${id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Buyer status could not be updated");
      setCurrent(next);
      setMessage(next === "ACTIVE" ? "Access restored" : "Access suspended");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Buyer status could not be updated");
    } finally {
      setSaving(false);
    }
  }

  return <div className="buyer-admin-status">
    <span className={`status-pill ${current.toLowerCase()}`}>{current}</span>
    <button type="button" className="table-action" disabled={saving} onClick={update}>{saving ? "Saving…" : current === "ACTIVE" ? "Suspend" : "Restore"}</button>
    {message ? <small role="status">{message}</small> : null}
  </div>;
}
