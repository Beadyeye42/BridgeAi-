"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle } from "lucide-react";

export function ClaimOpportunity({ reference }: { reference: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function claim() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/opportunities/${encodeURIComponent(reference)}/claim`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "This opportunity could not be claimed");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This opportunity could not be claimed");
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <p>Claiming reserves one of the five supplier places and unlocks the full customer brief and files.</p>
    <button className="button button-dark action-primary" disabled={busy} onClick={claim}>
      {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
      Claim place and view details
    </button>
    {message && <p className="form-result error">{message}</p>}
  </div>;
}
