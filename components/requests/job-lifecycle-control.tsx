"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";

type Action = "confirm" | "complete" | "cancel";

export function JobLifecycleControl({ reference, status }: { reference: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState("");

  async function update(action: Action) {
    const reason = action === "cancel" ? window.prompt("Why did this selected job not proceed?")?.trim() : undefined;
    if (action === "cancel" && !reason) return;
    setBusy(action);
    setMessage("");
    try {
      const response = await fetch(`/api/supplier/requests/${encodeURIComponent(reference)}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The job stage could not be updated.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The job stage could not be updated.");
    } finally {
      setBusy(null);
    }
  }

  if (status === "COMPLETED") return <div className="decision-state success"><span><CheckCircle2 size={17}/></span><b>Job completed</b><p>This outcome is recorded in your performance history.</p></div>;
  if (status === "CANCELLED_AFTER_SELECTION") return <div className="decision-state"><span><XCircle size={17}/></span><b>Job did not proceed</b><p>The selection remains in the audit history but is not counted as a confirmed job.</p></div>;
  return <div className="job-lifecycle-actions">
    <p>{status === "CONFIRMED" ? "When the work, order, hire or booking is finished, record the completed outcome." : "Only confirm the job after the customer and your company have agreed the order, booking or work."}</p>
    <button className="button button-dark action-primary" disabled={busy !== null} onClick={() => update(status === "CONFIRMED" ? "complete" : "confirm")}>
      {busy ? <LoaderCircle className="spin" size={15}/> : <CheckCircle2 size={15}/>} {status === "CONFIRMED" ? "Mark as Completed" : "Mark as Confirmed"}
    </button>
    <button className="decline-button" disabled={busy !== null} onClick={() => update("cancel")}><XCircle size={15}/>Did not proceed</button>
    {message && <p className="form-result error">{message}</p>}
  </div>;
}
