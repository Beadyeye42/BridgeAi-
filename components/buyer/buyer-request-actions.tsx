"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function BuyerRequestActions({ reference, quotes }: { reference: string; quotes: Array<{ label: string; conversationId: string | null; selectable: boolean }> }) {
  const router = useRouter();
  const [questions, setQuestions] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  async function sendQuestion(label: string, conversationId: string) {
    const body = questions[label]?.trim();
    if (!body) return;
    setBusy(`ask-${label}`); setMessage("");
    try {
      const response = await fetch("/api/buyer/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reference, conversationId, body }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) return setMessage(result.error ?? "The question could not be sent. Please try again.");
      setQuestions((current) => ({ ...current, [label]: "" }));
      setMessage(`Question sent privately to Quote ${label}.`); router.refresh();
    } catch {
      setMessage("The question could not be sent. Check your connection and try again.");
    } finally {
      setBusy("");
    }
  }

  async function selectQuote(label: string) {
    if (!confirm(`Select Quote ${label} to move forward? This will close the other quotes.`)) return;
    setBusy(`select-${label}`); setMessage("");
    try {
      const response = await fetch("/api/buyer/select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reference, label }) });
      const result = await response.json().catch(() => ({})) as { error?: string; orderReference?: string };
      if (!response.ok) return setMessage(result.error ?? "The quote could not be selected. Please try again.");
      if (result.orderReference) router.push(`/buyer/orders/${result.orderReference}`); else router.refresh();
    } catch {
      setMessage("The quote could not be selected. Check your connection and try again.");
    } finally {
      setBusy("");
    }
  }

  return <div className="buyer-action-stack">
    {quotes.map((quote) => <div className="buyer-question-box" key={quote.label}>
      <label htmlFor={`question-${quote.label}`}>Ask Quote {quote.label} a private question</label>
      <div><input id={`question-${quote.label}`} maxLength={2000} value={questions[quote.label] ?? ""} onChange={(event) => setQuestions((current) => ({ ...current, [quote.label]: event.target.value }))} placeholder="Ask about specification, availability or delivery" disabled={!quote.conversationId || busy !== ""} />
      <button type="button" onClick={() => quote.conversationId && sendQuestion(quote.label, quote.conversationId)} disabled={!quote.conversationId || !questions[quote.label]?.trim() || busy !== ""}>{busy === `ask-${quote.label}` ? "Sending…" : "Ask"}</button></div>
      {quote.selectable ? <button className="buyer-select-button" type="button" onClick={() => selectQuote(quote.label)} disabled={busy !== ""}>{busy === `select-${quote.label}` ? "Selecting securely…" : `Select Quote ${quote.label}`}</button> : null}
    </div>)}
    {message ? <p className="buyer-form-message" role="status">{message}</p> : null}
  </div>;
}
