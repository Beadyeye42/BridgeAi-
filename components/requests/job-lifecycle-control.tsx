"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle } from "lucide-react";

type Transition = { key: string; label: string; state: string; description?: string };

export function JobLifecycleControl({ reference, stageLabel, nextAction, transitions }: { reference: string; stageLabel: string; nextAction?: string; transitions: Transition[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function update(transition: Transition) {
    const reason = transition.state === "CANCELLED" ? window.prompt("Why did this arrangement not proceed?")?.trim() : undefined;
    if (transition.state === "CANCELLED" && !reason) return;
    setBusy(transition.key);
    setMessage("");
    try {
      const response = await fetch(`/api/supplier/requests/${encodeURIComponent(reference)}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageKey: transition.key, reason }),
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

  if (!transitions.length) return <div className="decision-state success"><span><CheckCircle2 size={17}/></span><b>{stageLabel}</b><p>{nextAction ?? "This stage is recorded in the permanent history."}</p></div>;
  return <div className="job-lifecycle-actions">
    <p>{nextAction ?? "Choose the next stage when the buyer and your company are ready."}</p>
    {transitions.map((transition) => <button className={transition.state === "CANCELLED" ? "decline-button" : "button button-dark action-primary"} disabled={busy !== null} key={transition.key} onClick={() => update(transition)}>
      {busy === transition.key ? <LoaderCircle className="spin" size={15}/> : <CheckCircle2 size={15}/>} {transition.label}
    </button>)}
    {message && <p className="form-result error">{message}</p>}
  </div>;
}
