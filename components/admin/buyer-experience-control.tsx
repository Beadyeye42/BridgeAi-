"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle } from "lucide-react";
import type { BuyerExperience } from "@/lib/buyer/industry-experience";

function stageLines(config: BuyerExperience) {
  return config.stages.map((stage) => [stage.key, stage.label, stage.state, stage.nextAction ?? "", stage.allowedNext.join(",")].join(" | ")).join("\n");
}

function fieldLines(config: BuyerExperience) {
  return config.detailFields.map((field) => [field.key, field.label, field.type, field.source].join(" | ")).join("\n");
}

export function BuyerExperienceControl({ id, config }: { id: string; config: BuyerExperience }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const stages = String(data.get("stages") ?? "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
        const [key, label, state, nextAction, allowedNext = ""] = line.split("|").map((value) => value.trim());
        return { key, label, state, ...(nextAction ? { nextAction } : {}), allowedNext: allowedNext.split(",").map((value) => value.trim()).filter(Boolean) };
      });
      const detailFields = String(data.get("detailFields") ?? "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
        const [key, label, type = "text", source = "qualification"] = line.split("|").map((value) => value.trim());
        return { key, label, type, source };
      });
      const labels = Object.fromEntries(["requestSingular", "requestPlural", "orderSingular", "orderPlural", "location", "requiredBy", "items", "files", "quote", "quotePlural"].map((key) => [key, String(data.get(key) ?? "").trim()]));
      const response = await fetch(`/api/admin/categories/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buyerExperienceConfig: { version: 1, labels, detailFields, stages } }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Buyer Hub configuration could not be saved");
      setMessage("Buyer Hub configuration saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Buyer Hub configuration could not be saved");
    } finally {
      setBusy(false);
    }
  }

  return <form className="panel form-section" onSubmit={submit}>
    <div className="section-heading"><div><p className="eyebrow">Buyer Hub</p><h2>Industry experience</h2></div></div>
    <div className="honesty-note">These labels, fields and stages are stored with the industry. Buyer Hub reads them at runtime, so adding or changing an industry does not require a rebuild.</div>
    <div className="form-grid">
      {Object.entries(config.labels).map(([key, value]) => <label className="form-control" key={key}><span>{key.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase())}</span><input name={key} defaultValue={value} required /></label>)}
    </div>
    <label className="form-control"><span>Configurable request fields</span><textarea name="detailFields" defaultValue={fieldLines(config)} rows={5} placeholder="access_notes | Access notes | text | qualification"/><small>One per line: key | label | text/number/date/boolean | qualification/request</small></label>
    <label className="form-control"><span>Lifecycle stages</span><textarea name="stages" defaultValue={stageLines(config)} rows={9} required/><small>One per line: key | label | SELECTED/ACTIVE/COMPLETED/CANCELLED/ISSUE_REPORTED | next action | comma-separated next stage keys</small></label>
    <button className="button button-dark" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>}Save Buyer Hub experience</button>
    {message && <p className="form-result" role="status">{message}</p>}
  </form>;
}
