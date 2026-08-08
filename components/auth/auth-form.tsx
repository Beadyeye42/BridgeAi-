"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

type Mode = "login" | "register" | "forgot" | "reset";

export function AuthForm({ mode, invitationToken }: { mode: Mode; invitationToken?: string }) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = Object.fromEntries(form.entries());
    if (mode === "register") payload.termsAccepted = form.get("termsAccepted") === "on";
    if (mode === "register" && invitationToken) payload.invitationToken = invitationToken;
    try {
      const response = await fetch(`/api/auth/${mode === "forgot" ? "forgot-password" : mode === "reset" ? "reset-password" : mode}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({} as { error?: string; redirectTo?: string; message?: string }));
      if (!response.ok) throw new Error(result.error ?? "Something went wrong");
      if (result.redirectTo) window.location.assign(result.redirectTo);
      else setMessage(result.message ?? "Done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally { setBusy(false); }
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      {mode === "register" && <div className="field-row"><Field label="First name" name="firstName" autoComplete="given-name" /><Field label="Last name" name="lastName" autoComplete="family-name" /></div>}
      {mode === "register" && !invitationToken && <Field label="Company name" name="companyName" autoComplete="organization" />}
      {mode !== "reset" && <Field label="Business email" name="email" type="email" autoComplete="email" icon={<Mail size={16} />} />}
      {mode === "register" && !invitationToken && <Field label="Phone number" name="phone" type="tel" autoComplete="tel" />}
      {(mode === "login" || mode === "register" || mode === "reset") && <label className="form-field"><span>{mode === "reset" ? "New password" : "Password"}{mode === "login" && <Link href="/forgot-password">Forgot password?</Link>}</span><div className="input-wrap"><LockKeyhole size={16} /><input name="password" type={showPassword ? "text" : "password"} minLength={mode === "login" ? undefined : 8} autoComplete={mode === "login" ? "current-password" : "new-password"} required /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>{mode !== "login" && <small>8+ characters with upper, lower and a number.</small>}</label>}
      {mode === "register" && <label className="check-field"><input type="checkbox" name="termsAccepted" /><span className="check-box"><Check size={12} /></span><span>I agree to the <Link href="/legal/terms">supplier terms</Link> and <Link href="/legal/privacy">privacy notice</Link>.</span></label>}
      {error && <p className="form-alert error" role="alert">{error}</p>}
      {message && <p className="form-alert success" role="status">{message}</p>}
      <button className="auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <>{submitLabel(mode)}<ArrowRight size={16} /></>}</button>
      <p className="form-security"><ShieldCheck size={14} />Protected by Supabase Auth, verified email and secure session cookies.</p>
    </form>
  );
}

function Field({ label, name, type = "text", autoComplete, icon }: { label: string; name: string; type?: string; autoComplete?: string; icon?: React.ReactNode }) {
  return <label className="form-field"><span>{label}</span><div className="input-wrap">{icon}<input name={name} type={type} autoComplete={autoComplete} required /></div></label>;
}

function submitLabel(mode: Mode) {
  if (mode === "login") return "Sign in to Bridge AI";
  if (mode === "register") return "Create supplier account";
  if (mode === "forgot") return "Send reset link";
  return "Set new password";
}
