"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, LoaderCircle, Save, Sparkles } from "lucide-react";

type CapacityStatus = "AVAILABLE" | "LIMITED" | "URGENT_ONLY" | "FULL" | "PAUSED";

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
  capacityStatus: CapacityStatus;
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
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [activeByCategory, setActiveByCategory] = useState<Record<string, boolean>>(() => Object.fromEntries(capabilities.map((item) => [item.productCategoryId, item.active])));
  const [capacityByCategory, setCapacityByCategory] = useState<Record<string, CapacityStatus>>(() => Object.fromEntries(capabilities.map((item) => [item.productCategoryId, item.capacityStatus])));
  const [confirmedByCategory, setConfirmedByCategory] = useState<Record<string, string | null>>(() => Object.fromEntries(capabilities.map((item) => [item.productCategoryId, item.lastConfirmedAt])));

  async function activate(capability: Capability) {
    setActivatingId(capability.productCategoryId);
    setMessage("");
    setError(false);
    try {
      const response = await fetch("/api/supplier/capabilities", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productCategoryId: capability.productCategoryId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? `${capability.categoryName} could not be activated`);
      setActiveByCategory((current) => ({ ...current, [capability.productCategoryId]: true }));
      setCapacityByCategory((current) => ({ ...current, [capability.productCategoryId]: "AVAILABLE" }));
      setConfirmedByCategory((current) => ({ ...current, [capability.productCategoryId]: result.capability?.lastConfirmedAt ?? new Date().toISOString() }));
      setMessage(`${capability.categoryName} is active and ready for general quote matching.`);
    } catch (caught) {
      setError(true);
      setMessage(caught instanceof Error ? caught.message : `${capability.categoryName} could not be activated`);
    } finally {
      setActivatingId(null);
    }
  }

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
      const confirmedAt = result.confirmedAt ?? new Date().toISOString();
      setConfirmedByCategory(Object.fromEntries(capabilities.map((item) => [item.productCategoryId, confirmedAt])));
      setMessage("Advanced matching details and current capacity saved.");
    } catch (caught) {
      setError(true); setMessage(caught instanceof Error ? caught.message : "Capabilities could not be saved");
    } finally { setBusy(false); }
  }

  if (!capabilities.length) return <section className="panel form-section"><div className="empty-state">Select your product categories in Company profile before configuring capability and capacity.</div></section>;

  const activeCount = Object.values(activeByCategory).filter(Boolean).length;
  return <form className="management-form" onSubmit={submit}>
    <section className="panel form-section capability-quick-setup">
      <div className="section-heading">
        <div><p className="eyebrow">Simple setup</p><h2>Activate the products you supply</h2></div>
        <span className="status-pill active">{activeCount} active</span>
      </div>
      <p className="body-copy capability-intro">Press one button for each product you want to receive general enquiries for. The change saves immediately. Add systems, colours and lead times under Advanced matching when you want more precise opportunities.</p>
      <div className="capability-quick-grid">
        {capabilities.map((capability) => {
          const active = activeByCategory[capability.productCategoryId];
          const isActivating = activatingId === capability.productCategoryId;
          return <article className={`capability-quick-card ${active ? "is-active" : ""}`} key={capability.productCategoryId}>
            <span className="capability-quick-icon">{active ? <CheckCircle2 size={18}/> : <Sparkles size={18}/>}</span>
            <div><b>{capability.categoryName}</b><small>{active ? "Active for quote matching" : "Not receiving matching enquiries"}</small></div>
            {active
              ? <span className="status-pill active">Active</span>
              : <button className="button capability-activate-button" type="button" disabled={Boolean(activatingId) || busy} onClick={() => activate(capability)}>{isActivating ? <LoaderCircle className="spin" size={14}/> : null}{isActivating ? "Activating…" : "Activate for quotes"}</button>}
          </article>;
        })}
      </div>
    </section>

    <div className="honesty-note">Advanced details make matching safer and more accurate. Exact requests for a particular system, colour or deadline are only sent when your saved details confirm you can meet them. Confirm availability whenever it changes.</div>

    {capabilities.map((capability) => {
      const prefix = capability.productCategoryId;
      const active = activeByCategory[prefix];
      return <section className="panel capability-advanced-card" key={prefix}>
        <details>
          <summary>
            <span className="capability-summary-copy"><span className={`status-pill ${active ? "active" : "expired"}`}>{active ? "Active" : "Not active"}</span><b>{capability.categoryName}</b><small>Advanced matching details</small></span>
            <span className="capability-summary-action">Edit details <ChevronDown size={16}/></span>
          </summary>
          <div className="capability-advanced-content">
            <label className="toggle-row"><span><b>Use this product for matching</b><small>Turn this off and save to pause this product</small></span><input type="checkbox" name={`${prefix}:active`} checked={active} onChange={(event) => setActiveByCategory((current) => ({ ...current, [prefix]: event.target.checked }))}/></label>
            <div className="form-grid capability-fields">
              <Field name={`${prefix}:manufacturers`} label="Manufacturers" value={capability.manufacturerNames.join(", ")} placeholder="For example Liniar, Rehau, VEKA" />
              <Field name={`${prefix}:systems`} label="Profile systems or brands" value={capability.systemNames.join(", ")} placeholder="Comma-separated systems" />
              <Field name={`${prefix}:colours`} label="Colours supplied" value={capability.colourNames.join(", ")} placeholder="White, anthracite grey, Chartwell green" />
              <Field name={`${prefix}:finishes`} label="Finishes supplied" value={capability.finishNames.join(", ")} placeholder="Foil, powder coat, anodised" />
              <Field name={`${prefix}:minimumQuantity`} label="Minimum order quantity" value={capability.minimumOrderQuantity ?? ""} type="number" min="1" />
              <Field name={`${prefix}:minimumValue`} label="Minimum order value (£)" value={capability.minimumOrderValue ?? ""} type="number" min="0" step="0.01" />
              <Field name={`${prefix}:standardLead`} label="Standard lead time (days)" value={capability.standardLeadTimeDays} type="number" min="1" required />
              <Field name={`${prefix}:urgentLead`} label="Urgent lead time (days)" value={capability.urgentLeadTimeDays ?? ""} type="number" min="1" />
              <label className="form-control"><span>Current capacity</span><select name={`${prefix}:capacity`} value={capacityByCategory[prefix]} onChange={(event) => setCapacityByCategory((current) => ({ ...current, [prefix]: event.target.value as CapacityStatus }))}><option value="AVAILABLE">Available</option><option value="LIMITED">Limited</option><option value="URGENT_ONLY">Urgent work only</option><option value="FULL">Temporarily full</option><option value="PAUSED">Paused</option></select></label>
              <label className="toggle-row"><span><b>Collection available</b><small>Customers may collect from you</small></span><input type="checkbox" name={`${prefix}:collection`} defaultChecked={capability.collectionAvailable}/></label>
              <Field name={`${prefix}:shortageNote`} label="Temporary shortage" value={capability.shortageNote ?? ""} placeholder="Leave blank when there is no shortage" />
              <Field name={`${prefix}:shortageUntil`} label="Shortage expected until" value={capability.shortageUntil?.slice(0, 10) ?? ""} type="date" />
            </div>
            <div className="form-control"><span>Normal delivery days</span><div className="inline-actions">{dayOptions.map(([day, label]) => <label className="choice-card day-choice" key={day}><input type="checkbox" name={`${prefix}:day:${day}`} defaultChecked={capability.deliveryDays.includes(day)}/><span><b>{label}</b></span></label>)}</div></div>
            <p className="body-copy">Last confirmed: {confirmedByCategory[prefix] ? new Date(confirmedByCategory[prefix]!).toLocaleString("en-GB") : "Not confirmed yet"}</p>
          </div>
        </details>
      </section>;
    })}
    <div className="sticky-save">{message && <p className={`form-result ${error ? "error" : "success"}`}>{!error && <CheckCircle2 size={14}/>} {message}</p>}<button className="button button-dark" disabled={busy || Boolean(activatingId)}>{busy ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>} {busy ? "Saving…" : "Save advanced details"}</button></div>
  </form>;
}

function Field({ name, label, value, placeholder, type = "text", min, step, required }: { name: string; label: string; value: string | number; placeholder?: string; type?: string; min?: string; step?: string; required?: boolean }) {
  return <label className="form-control"><span>{label}</span><input name={name} defaultValue={value} placeholder={placeholder} type={type} min={min} step={step} required={required}/></label>;
}
