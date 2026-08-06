"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle, Save } from "lucide-react";

type Capability = {
  productCategoryId: string;
  categoryName: string;
  manufacturerNames: string[];
  systemNames: string[];
  colourNames: string[];
  finishNames: string[];
  minimumOrderValue: number | null;
  minimumOrderQuantity: number | null;
  standardLeadTimeDays: number;
  urgentLeadTimeDays: number | null;
  collectionAvailable: boolean;
  deliveryDays: number[];
  capacityStatus: "AVAILABLE" | "LIMITED" | "URGENT_ONLY" | "FULL" | "PAUSED";
  shortageNote: string | null;
  shortageUntil: string | null;
  active: boolean;
  lastConfirmedAt: string | null;
};

const dayOptions = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]] as const;
const splitList = (value: FormDataEntryValue | null) => String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const nullableNumber = (value: FormDataEntryValue | null) => String(value ?? "").trim() ? Number(value) : null;

export function CapabilityManager({ capabilities }: { capabilities: Capability[] }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(""); setError(false);
    const form = new FormData(event.currentTarget);
    const payload = capabilities.map((capability) => {
      const prefix = capability.productCategoryId;
      return {
        productCategoryId: prefix,
        manufacturerNames: splitList(form.get(`${prefix}:manufacturers`)),
        systemNames: splitList(form.get(`${prefix}:systems`)),
        colourNames: splitList(form.get(`${prefix}:colours`)),
        finishNames: splitList(form.get(`${prefix}:finishes`)),
        minimumOrderValue: nullableNumber(form.get(`${prefix}:minimumValue`)),
        minimumOrderQuantity: nullableNumber(form.get(`${prefix}:minimumQuantity`)),
        standardLeadTimeDays: Number(form.get(`${prefix}:standardLead`)),
        urgentLeadTimeDays: nullableNumber(form.get(`${prefix}:urgentLead`)),
        collectionAvailable: form.has(`${prefix}:collection`),
        deliveryDays: dayOptions.filter(([day]) => form.has(`${prefix}:day:${day}`)).map(([day]) => day),
        capacityStatus: String(form.get(`${prefix}:capacity`)),
        shortageNote: String(form.get(`${prefix}:shortageNote`) ?? "").trim() || null,
        shortageUntil: String(form.get(`${prefix}:shortageUntil`) ?? "").trim() ? new Date(`${String(form.get(`${prefix}:shortageUntil`))}T23:59:59.000Z`).toISOString() : null,
        active: form.has(`${prefix}:active`),
      };
    });
    try {
      const response = await fetch("/api/supplier/capabilities", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ capabilities: payload }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Capabilities could not be saved");
      setMessage("Capabilities and current capacity confirmed. New matching decisions will use this information.");
    } catch (caught) {
      setError(true); setMessage(caught instanceof Error ? caught.message : "Capabilities could not be saved");
    } finally { setBusy(false); }
  }

  if (!capabilities.length) return <section className="panel form-section"><div className="empty-state">Select your product categories in Company profile before configuring capability and capacity.</div></section>;
  return <form className="management-form" onSubmit={submit}>
    <div className="honesty-note">Confirm this information whenever lead times or availability change. Bridge AI treats availability older than 14 days as less reliable and will not use stale data to promise an urgent deadline.</div>
    {capabilities.map((capability) => {
      const prefix = capability.productCategoryId;
      return <section className="panel form-section" key={prefix}>
        <div className="section-heading"><div><p className="eyebrow">Live supplier capability</p><h2>{capability.categoryName}</h2></div><label className="toggle-row compact-toggle"><span><b>Use for matching</b></span><input type="checkbox" name={`${prefix}:active`} defaultChecked={capability.active}/></label></div>
        <div className="form-grid">
          <Field name={`${prefix}:manufacturers`} label="Manufacturers" value={capability.manufacturerNames.join(", ")} placeholder="For example Liniar, Rehau, VEKA" />
          <Field name={`${prefix}:systems`} label="Profile systems or brands" value={capability.systemNames.join(", ")} placeholder="Comma-separated systems" />
          <Field name={`${prefix}:colours`} label="Colours supplied" value={capability.colourNames.join(", ")} placeholder="White, anthracite grey, Chartwell green" />
          <Field name={`${prefix}:finishes`} label="Finishes supplied" value={capability.finishNames.join(", ")} placeholder="Foil, powder coat, anodised" />
          <Field name={`${prefix}:minimumQuantity`} label="Minimum order quantity" value={capability.minimumOrderQuantity ?? ""} type="number" min="1" />
          <Field name={`${prefix}:minimumValue`} label="Minimum order value (£)" value={capability.minimumOrderValue ?? ""} type="number" min="0" step="0.01" />
          <Field name={`${prefix}:standardLead`} label="Standard lead time (days)" value={capability.standardLeadTimeDays} type="number" min="1" required />
          <Field name={`${prefix}:urgentLead`} label="Urgent lead time (days)" value={capability.urgentLeadTimeDays ?? ""} type="number" min="1" />
          <label className="form-control"><span>Current capacity</span><select name={`${prefix}:capacity`} defaultValue={capability.capacityStatus}><option value="AVAILABLE">Available</option><option value="LIMITED">Limited</option><option value="URGENT_ONLY">Urgent work only</option><option value="FULL">Temporarily full</option><option value="PAUSED">Paused</option></select></label>
          <label className="toggle-row"><span><b>Collection available</b><small>Customers may collect from you</small></span><input type="checkbox" name={`${prefix}:collection`} defaultChecked={capability.collectionAvailable}/></label>
          <Field name={`${prefix}:shortageNote`} label="Temporary shortage" value={capability.shortageNote ?? ""} placeholder="Leave blank when there is no shortage" />
          <Field name={`${prefix}:shortageUntil`} label="Shortage expected until" value={capability.shortageUntil?.slice(0, 10) ?? ""} type="date" />
        </div>
        <div className="form-control"><span>Normal delivery days</span><div className="inline-actions">{dayOptions.map(([day, label]) => <label className="choice-card day-choice" key={day}><input type="checkbox" name={`${prefix}:day:${day}`} defaultChecked={capability.deliveryDays.includes(day)}/><span><b>{label}</b></span></label>)}</div></div>
        <p className="body-copy">Last confirmed: {capability.lastConfirmedAt ? new Date(capability.lastConfirmedAt).toLocaleString("en-GB") : "Not confirmed yet"}</p>
      </section>;
    })}
    <div className="sticky-save">{message && <p className={`form-result ${error ? "error" : "success"}`}>{!error && <CheckCircle2 size={14}/>} {message}</p>}<button className="button button-dark" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>} {busy ? "Saving…" : "Confirm capabilities"}</button></div>
  </form>;
}

function Field({ name, label, value, placeholder, type = "text", min, step, required }: { name: string; label: string; value: string | number; placeholder?: string; type?: string; min?: string; step?: string; required?: boolean }) {
  return <label className="form-control"><span>{label}</span><input name={name} defaultValue={value} placeholder={placeholder} type={type} min={min} step={step} required={required}/></label>;
}
