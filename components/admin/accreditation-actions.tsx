"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, X } from "lucide-react";

export function AccreditationReviewActions({ id, scanStatus }: { id: string; scanStatus: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function review(status: "APPROVED" | "REJECTED") {
    const note = status === "REJECTED" ? window.prompt("Reason for rejection (shown to the supplier)")?.trim() : undefined;
    if (status === "REJECTED" && !note) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/accreditations/${id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Review failed");
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <div className="inline-actions">
      <button className="button button-dark" disabled={busy || scanStatus !== "CLEAN"} onClick={() => review("APPROVED")} title={scanStatus !== "CLEAN" ? "Security scan must pass first" : undefined}>{busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}Approve</button>
      <button className="button button-outline danger" disabled={busy} onClick={() => review("REJECTED")}><X size={14} />Reject</button>
    </div>
    {message && <small className="error-text">{message}</small>}
  </div>;
}
