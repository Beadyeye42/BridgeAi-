"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, LoaderCircle, MessageSquareText, Send, ShieldCheck } from "lucide-react";

type Question = {
  id: string;
  body: string;
  createdAt: string;
  dueAt: string | null;
  answer: string | null;
};

async function json(response: Response) {
  const body = await response.text();
  if (!body) return {} as { error?: string };
  try { return JSON.parse(body) as { error?: string }; } catch { return {} as { error?: string }; }
}

export function QuoteConversationPanel({
  conversationId,
  anonymousLabel,
  status,
  questions,
}: {
  conversationId: string;
  anonymousLabel: string;
  status: string;
  questions: Question[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});

  async function reply(event: React.FormEvent<HTMLFormElement>, questionId: string) {
    event.preventDefault();
    setBusyId(questionId);
    setFeedback((current) => ({ ...current, [questionId]: "" }));
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/quote-conversations/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, replyToId: questionId, body: data.get("body") }),
      });
      const result = await json(response);
      if (!response.ok) throw new Error(result.error ?? "The reply could not be sent.");
      setFeedback((current) => ({ ...current, [questionId]: "Reply queued securely for delivery to the buyer on WhatsApp." }));
      router.refresh();
    } catch (error) {
      setFeedback((current) => ({ ...current, [questionId]: error instanceof Error ? error.message : "The reply could not be sent." }));
    } finally {
      setBusyId(null);
    }
  }

  return <section className="panel request-section quote-conversation-panel">
    <div className="section-title"><MessageSquareText size={18}/><div><p className="eyebrow">Private conversation · Quote {anonymousLabel}</p><h2>Buyer questions</h2></div></div>
    <div className="privacy-note"><ShieldCheck size={17}/><div><b>Identity protected</b><p>Answer specifications, availability and delivery questions here. Phone numbers, emails, addresses, links and social handles are blocked until the buyer selects a quote.</p></div></div>
    {!questions.length && <p className="request-summary">The buyer has not asked this quote a question yet. New questions will appear here and trigger your notification preferences.</p>}
    <div className="quote-question-list">{questions.map((question) => {
      const due = question.dueAt ? new Date(question.dueAt) : null;
      const closed = status !== "OPEN" || Boolean(question.answer) || Boolean(due && due <= new Date());
      return <article className="quote-question" key={question.id}>
        <div className="quote-question-meta"><b>Buyer</b><span>{new Date(question.createdAt).toLocaleString("en-GB")}</span>{due && <span><Clock3 size={13}/> Reply by {due.toLocaleString("en-GB")}</span>}</div>
        <p>{question.body}</p>
        {question.answer ? <div className="quote-answer"><b>Your reply</b><p>{question.answer}</p></div> : closed ? <p className="form-result">This question is closed.</p> : <form className="quote-reply-form" onSubmit={(event) => reply(event, question.id)}>
          <label>Reply privately<textarea name="body" required minLength={2} maxLength={2000} rows={4} placeholder="Answer the buyer’s question without adding contact details."/></label>
          <button className="button button-dark" disabled={busyId === question.id}>{busyId === question.id ? <LoaderCircle className="spin" size={15}/> : <Send size={15}/>}Send reply</button>
        </form>}
        {feedback[question.id] && <p className="form-result">{feedback[question.id]}</p>}
      </article>;
    })}</div>
  </section>;
}
