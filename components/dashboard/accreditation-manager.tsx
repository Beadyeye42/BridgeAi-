"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileBadge2, LoaderCircle, ShieldCheck, Trash2, Upload } from "lucide-react";

type Accreditation = {
  id: string;
  type: string;
  displayName: string;
  referenceNumber: string | null;
  issuingBody: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  status: string;
  reviewNote: string | null;
  attachment: { id: string; fileName: string; scanStatus: string };
};

const typeLabels: Record<string, string> = {
  PUBLIC_LIABILITY_INSURANCE: "Public liability insurance",
  EMPLOYERS_LIABILITY_INSURANCE: "Employers’ liability insurance",
  PROFESSIONAL_INDEMNITY_INSURANCE: "Professional indemnity insurance",
  TRADE_BODY_MEMBERSHIP: "Trade body membership",
  CERTIFICATION: "Certification",
  OTHER: "Other evidence",
};

export function AccreditationManager({ accreditations, canManage }: { accreditations: Accreditation[]; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      const response = await fetch("/api/uploads/accreditation", { method: "POST", body: new FormData(form) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Upload failed");
      form.reset();
      setMessage("Document uploaded. It will remain locked until its security scan completes.");
      router.refresh();
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this accreditation document?")) return;
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      const response = await fetch(`/api/supplier/accreditations/${id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Delete failed");
      setMessage("Document removed.");
      router.refresh();
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel form-section">
    <div className="section-heading"><div><p className="eyebrow">Approval evidence</p><h2>Accreditations & insurance</h2></div><ShieldCheck size={20} /></div>
    <p className="body-copy">Upload current insurance, trade memberships and certifications. Files are private and cannot be reviewed or downloaded until their security scan passes.</p>
    <div className="entity-list">
      {accreditations.length === 0 && <div className="empty-state">No accreditation documents uploaded yet.</div>}
      {accreditations.map((item) => {
        const downloadable = item.attachment.scanStatus === "CLEAN";
        const removable = canManage && ["PENDING", "REJECTED"].includes(item.status);
        return <article className="entity-row accreditation-row" key={item.id}>
          <span className="large-icon"><FileBadge2 size={20} /></span>
          <div>
            <b>{item.displayName}</b>
            <small>{typeLabels[item.type] ?? item.type}{item.issuingBody ? ` · ${item.issuingBody}` : ""}{item.referenceNumber ? ` · ${item.referenceNumber}` : ""}</small>
            <small>{item.expiresAt ? `Expires ${new Date(item.expiresAt).toLocaleDateString("en-GB")}` : "No expiry supplied"} · scan {item.attachment.scanStatus.toLowerCase()}</small>
            {item.reviewNote && <small className="error-text">Review note: {item.reviewNote}</small>}
          </div>
          <span className={`status-pill ${item.status.toLowerCase()}`}>{item.status}</span>
          <div className="inline-actions">
            {downloadable && <a className="icon-button subtle" href={`/api/attachments/${item.attachment.id}/download`} aria-label={`Download ${item.attachment.fileName}`}><Download size={15} /></a>}
            {removable && <button className="icon-button subtle danger" type="button" disabled={busy} onClick={() => remove(item.id)} aria-label={`Delete ${item.displayName}`}><Trash2 size={15} /></button>}
          </div>
        </article>;
      })}
    </div>
    {canManage ? <form className="form-stack accreditation-upload" onSubmit={upload}>
      <div className="section-subheading">Upload evidence</div>
      <div className="form-grid">
        <label className="form-control"><span>Document type</span><select name="type" required>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="form-control"><span>Document name</span><input name="displayName" minLength={2} maxLength={160} placeholder="2026 public liability policy" required /></label>
        <label className="form-control"><span>Issuer</span><input name="issuingBody" maxLength={160} placeholder="Insurance company or trade body" /></label>
        <label className="form-control"><span>Policy or reference number</span><input name="referenceNumber" maxLength={120} /></label>
        <label className="form-control"><span>Issue date</span><input name="issuedAt" type="date" /></label>
        <label className="form-control"><span>Expiry date</span><input name="expiresAt" type="date" /></label>
        <label className="form-control span-2"><span>Document file</span><input name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required /><small>PDF, PNG, JPEG or WebP · maximum 10 MB</small></label>
      </div>
      <div className="form-actions"><p className={`form-result${error ? " error" : ""}`}>{message}</p><button className="button button-dark" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}Upload document</button></div>
    </form> : <div className="honesty-note">Only company owners and managers can add or remove accreditation documents.</div>}
  </section>;
}
