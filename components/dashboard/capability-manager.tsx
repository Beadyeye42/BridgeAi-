"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, LoaderCircle, Save, Sparkles } from "lucide-react";
import {
  includesCapabilityValue,
  isRalCode,
  isRalColourMarker,
  isStandardColour,
  isPheCapabilityCategory,
  isTransportCapabilityCategory,
  PHE_MANUFACTURER_OPTIONS_BY_CATEGORY,
  PHE_SYSTEM_OPTIONS_BY_CATEGORY,
  PROFILE_SYSTEM_OPTIONS_BY_CATEGORY,
  RAL_COLOUR_MARKER,
  STANDARD_COLOUR_OPTIONS,
  TRANSPORT_SERVICE_FEATURE_OPTIONS,
  TRANSPORT_VEHICLE_OPTIONS,
} from "@/lib/capabilities/options";

type CapacityStatus = "AVAILABLE" | "LIMITED" | "URGENT_ONLY" | "FULL" | "PAUSED" | "HOLIDAY" | "NOT_ACCEPTING";

type Capability = {
  productCategoryId: string;
  categoryName: string;
  categorySlug: string;
  industryName: string;
  industrySlug: string;
  manufacturerNames: string[];
  systemNames: string[];
  colourNames: string[];
  finishNames: string[];
  minimumOrderValue: number | null;
  minimumOrderQuantity: number | null;
  standardLeadTimeDays: number;
  urgentLeadTimeDays: number | null;
  currentLeadTimeDays: number | null;
  declaredMonthlyCapacity: number | null;
  supportsSupplyOnly: boolean;
  supportsDelivery: boolean;
  supportsInstallation: boolean;
  supportsService: boolean;
  servesConsumer: boolean;
  servesTrade: boolean;
  servesBusiness: boolean;
  collectionAvailable: boolean;
  deliveryDays: number[];
  capacityStatus: CapacityStatus;
  restrictedProducts: string[];
  deliveryDelayDays: number | null;
  shortageNote: string | null;
  shortageUntil: string | null;
  active: boolean;
  lastConfirmedAt: string | null;
};

type RematchResult = { checked?: number; matched?: number; blocked?: number; blockingReasons?: string[] };

const dayOptions = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]] as const;
const splitList = (value: FormDataEntryValue | null) => String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const stringList = (values: FormDataEntryValue[]) => values.map(String).map((item) => item.trim()).filter(Boolean);
const uniqueList = (values: string[]) => [...new Set(values)];
const nullableNumber = (value: FormDataEntryValue | null) => String(value ?? "").trim() ? Number(value) : null;
const friendlyBlockingReason = (reason: string) => {
  const missingDetail = reason.match(/^Does not confirm (manufacturer|system|colour|finish) (.+)$/i);
  if (!missingDetail) return reason;
  const [, field, value] = missingDetail;
  return `add ${value} to your saved ${field} details if you supply it`;
};

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
      const rematch = (result.rematch ?? {}) as RematchResult;
      if (rematch.matched) {
        setMessage(`${capability.categoryName} is active. ${rematch.matched} current quote request${rematch.matched === 1 ? " has" : "s have"} been matched to your company.`);
      } else if (rematch.blocked && rematch.blockingReasons?.length) {
        setMessage(`${capability.categoryName} is active. A current request needs more detail before it can match: ${friendlyBlockingReason(rematch.blockingReasons[0])}. Open Advanced matching below and save.`);
      } else {
        setMessage(`${capability.categoryName} is active and ready for general quote matching.`);
      }
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
      const selectedProfiles = stringList(form.getAll(`${prefix}:profile`));
      const selectedManufacturers = stringList(form.getAll(`${prefix}:manufacturer`));
      const selectedSystems = stringList(form.getAll(`${prefix}:system`));
      const selectedColours = stringList(form.getAll(`${prefix}:colour`));
      const selectedFeatures = stringList(form.getAll(`${prefix}:feature`));
      return {
        productCategoryId: prefix,
        manufacturerNames: uniqueList([...selectedProfiles, ...selectedManufacturers, ...splitList(form.get(`${prefix}:manufacturers`))]),
        systemNames: uniqueList([...selectedProfiles, ...selectedSystems, ...splitList(form.get(`${prefix}:systems`))]),
        colourNames: uniqueList([
          ...selectedColours,
          ...splitList(form.get(`${prefix}:ralCodes`)),
          ...splitList(form.get(`${prefix}:otherColours`)),
        ]),
        finishNames: uniqueList([...selectedFeatures, ...splitList(form.get(`${prefix}:finishes`))]),
        minimumOrderValue: nullableNumber(form.get(`${prefix}:minimumValue`)),
        minimumOrderQuantity: nullableNumber(form.get(`${prefix}:minimumQuantity`)),
        standardLeadTimeDays: Number(form.get(`${prefix}:standardLead`)),
        urgentLeadTimeDays: nullableNumber(form.get(`${prefix}:urgentLead`)),
        currentLeadTimeDays: nullableNumber(form.get(`${prefix}:currentLead`)),
        declaredMonthlyCapacity: nullableNumber(form.get(`${prefix}:declaredMonthlyCapacity`)),
        supportsSupplyOnly: form.has(`${prefix}:supplyOnly`),
        supportsDelivery: form.has(`${prefix}:delivery`),
        supportsInstallation: form.has(`${prefix}:installation`),
        supportsService: form.has(`${prefix}:service`),
        servesConsumer: form.has(`${prefix}:consumer`),
        servesTrade: form.has(`${prefix}:trade`),
        servesBusiness: form.has(`${prefix}:business`),
        collectionAvailable: form.has(`${prefix}:collection`),
        deliveryDays: dayOptions.filter(([day]) => form.has(`${prefix}:day:${day}`)).map(([day]) => day),
        capacityStatus: String(form.get(`${prefix}:capacity`)),
        restrictedProducts: splitList(form.get(`${prefix}:restrictedProducts`)),
        deliveryDelayDays: nullableNumber(form.get(`${prefix}:deliveryDelay`)),
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
      const rematch = (result.rematch ?? {}) as RematchResult;
      if (rematch.matched) {
        setMessage(`Advanced details saved. ${rematch.matched} current quote request${rematch.matched === 1 ? " is" : "s are"} now available on your dashboard.`);
      } else if (rematch.blocked && rematch.blockingReasons?.length) {
        setMessage(`Advanced details saved. A current request is still blocked: ${friendlyBlockingReason(rematch.blockingReasons[0])}.`);
      } else {
        setMessage("Advanced matching details and current capacity saved. Open requests were re-checked.");
      }
    } catch (caught) {
      setError(true); setMessage(caught instanceof Error ? caught.message : "Capabilities could not be saved");
    } finally { setBusy(false); }
  }

  if (!capabilities.length) return <section className="panel form-section"><div className="empty-state">Select your product categories in Company profile before configuring capability and capacity.</div></section>;

  const activeCount = Object.values(activeByCategory).filter(Boolean).length;
  const industryNames = [...new Set(capabilities.map((capability) => capability.industryName))];
  return <form className="management-form" onSubmit={submit}>
    <section className="panel form-section capability-quick-setup">
      <div className="section-heading">
        <div><p className="eyebrow">Simple setup</p><h2>Activate the products you supply</h2></div>
        <span className="status-pill active">{activeCount} active</span>
      </div>
      <p className="body-copy capability-intro">Press one button for each product you want to receive general enquiries for. The change saves immediately. Advanced matching then shows the brands and technical options relevant to each industry.</p>
      {industryNames.map((industryName) => <div className="capability-industry-group" key={industryName}>
        <div className="capability-option-heading"><b>{industryName}</b><small>Only products selected in your company profile appear here.</small></div>
        <div className="capability-quick-grid">
          {capabilities.filter((capability) => capability.industryName === industryName).map((capability) => {
            const active = activeByCategory[capability.productCategoryId];
            const isActivating = activatingId === capability.productCategoryId;
            return <article className={`capability-quick-card ${active ? "is-active" : ""}`} key={capability.productCategoryId}>
              <span className="capability-quick-icon">{active ? <CheckCircle2 size={18}/> : <Sparkles size={18}/>}</span>
              <div><b>{capability.categoryName}</b><small>{active ? "Active for quote matching" : "Not receiving matching enquiries"}</small></div>
              {active
                ? <div className="inline-actions"><span className="status-pill active">Active</span><button className="button button-secondary capability-recheck-button" type="button" disabled={Boolean(activatingId) || busy} onClick={() => activate(capability)}>{isActivating ? <LoaderCircle className="spin" size={14}/> : null}{isActivating ? "Checking…" : "Re-check quotes"}</button></div>
                : <button className="button capability-activate-button" type="button" disabled={Boolean(activatingId) || busy} onClick={() => activate(capability)}>{isActivating ? <LoaderCircle className="spin" size={14}/> : null}{isActivating ? "Activating…" : "Activate for quotes"}</button>}
            </article>;
          })}
        </div>
      </div>)}
    </section>

    <div className="honesty-note">Advanced details make matching safer and more accurate. Exact requests for a particular system, colour or deadline are only sent when your saved details confirm you can meet them. Confirm availability whenever it changes.</div>

    {capabilities.map((capability) => {
      const prefix = capability.productCategoryId;
      const active = activeByCategory[prefix];
      const isPhe = isPheCapabilityCategory(capability.categorySlug);
      const isTransport = isTransportCapabilityCategory(capability.categorySlug);
      const profileOptions = PROFILE_SYSTEM_OPTIONS_BY_CATEGORY[capability.categorySlug] ?? [];
      const manufacturerOptions = PHE_MANUFACTURER_OPTIONS_BY_CATEGORY[capability.categorySlug] ?? [];
      const systemOptions = PHE_SYSTEM_OPTIONS_BY_CATEGORY[capability.categorySlug] ?? [];
      const knownProfileValues = [...capability.manufacturerNames, ...capability.systemNames];
      const selectedRal = capability.colourNames.some(isRalColourMarker);
      const ralCodes = capability.colourNames.filter(isRalCode);
      const otherColours = capability.colourNames.filter((value) => !isStandardColour(value) && !isRalColourMarker(value) && !isRalCode(value));
      const otherSystems = capability.systemNames.filter((value) => ![...profileOptions, ...systemOptions].some((option) => includesCapabilityValue([value], option)));
      const otherManufacturers = capability.manufacturerNames.filter((value) => ![...profileOptions, ...manufacturerOptions].some((option) => includesCapabilityValue([value], option)));
      const otherTransportVehicles = capability.systemNames.filter((value) => !TRANSPORT_VEHICLE_OPTIONS.some((option) => includesCapabilityValue([value], option)));
      const otherTransportFeatures = capability.finishNames.filter((value) => !TRANSPORT_SERVICE_FEATURE_OPTIONS.some((option) => includesCapabilityValue([value], option)));
      return <section className="panel capability-advanced-card" key={prefix}>
        <details>
          <summary>
            <span className="capability-summary-copy"><span className={`status-pill ${active ? "active" : "expired"}`}>{active ? "Active" : "Not active"}</span><b>{capability.categoryName}</b><small>Advanced matching details</small></span>
            <span className="capability-summary-action">Edit details <ChevronDown size={16}/></span>
          </summary>
          <div className="capability-advanced-content">
            <label className="toggle-row"><span><b>Use this product for matching</b><small>Turn this off and save to pause this product</small></span><input type="checkbox" name={`${prefix}:active`} checked={active} onChange={(event) => setActiveByCategory((current) => ({ ...current, [prefix]: event.target.checked }))}/></label>
            <div className="capability-option-section">
              <div className="capability-option-heading"><b>Who do you want to quote for?</b><small>Bridge AI will only send this product to the buyer types you select.</small></div>
              <div className="capability-option-grid capability-audience-grid">
                <OptionCard name={`${prefix}:consumer`} value="yes" checked={capability.servesConsumer} description="Homeowners and people buying personally" label="Consumers / homeowners" />
                <OptionCard name={`${prefix}:trade`} value="yes" checked={capability.servesTrade} description="Installers, builders and other trades" label="Trade buyers" />
                <OptionCard name={`${prefix}:business`} value="yes" checked={capability.servesBusiness} description="Companies, organisations and commercial buyers" label="Businesses" />
              </div>
            </div>
            {isTransport ? <>
              <div className="honesty-note">This setup is specific to transport and removals. Select only vehicles, crew and handling services you can genuinely provide; Bridge AI uses these details to avoid unsuitable jobs.</div>
              <div className="capability-option-section">
                <div className="capability-option-heading"><b>Vehicles available</b><small>Tick every vehicle type you can allocate to this service.</small></div>
                <div className="capability-option-grid">
                  {TRANSPORT_VEHICLE_OPTIONS.map((option) => <OptionCard key={option} name={`${prefix}:system`} value={option} checked={includesCapabilityValue(capability.systemNames, option)} />)}
                </div>
                <Field name={`${prefix}:systems`} label="Other vehicle types (optional)" value={otherTransportVehicles.join(", ")} placeholder="Add other vehicles, separated by commas" />
              </div>
              <div className="capability-option-section">
                <div className="capability-option-heading"><b>Crew and service features</b><small>Select the handling and delivery options you actively offer.</small></div>
                <div className="capability-option-grid">
                  {TRANSPORT_SERVICE_FEATURE_OPTIONS.map((option) => <OptionCard key={option} name={`${prefix}:feature`} value={option} checked={includesCapabilityValue(capability.finishNames, option)} />)}
                </div>
              </div>
            </> : profileOptions.length ? <div className="capability-option-section">
              <div className="capability-option-heading"><b>Profile systems</b><small>Tick every system or brand your company supplies.</small></div>
              <div className="capability-option-grid">
                {profileOptions.map((option) => <OptionCard key={option} name={`${prefix}:profile`} value={option} checked={includesCapabilityValue(knownProfileValues, option)} />)}
              </div>
              <div className="form-grid">
                <Field name={`${prefix}:systems`} label="Other profile systems (optional)" value={otherSystems.join(", ")} placeholder="Add any other systems, separated by commas" />
                <Field name={`${prefix}:manufacturers`} label="Other manufacturers (optional)" value={otherManufacturers.join(", ")} placeholder="Add any other manufacturers" />
              </div>
            </div> : isPhe ? <>
              <div className="honesty-note">This setup is specific to plumbing, heating and mechanical procurement. Select only brands and system types you can supply; Bridge AI will use them as mandatory filters when a buyer names one.</div>
              <div className="capability-option-section">
                <div className="capability-option-heading"><b>Manufacturers and brands</b><small>Tick every listed brand your company can quote.</small></div>
                <div className="capability-option-grid">
                  {manufacturerOptions.map((option) => <OptionCard key={option} name={`${prefix}:manufacturer`} value={option} checked={includesCapabilityValue(capability.manufacturerNames, option)} />)}
                </div>
                <Field name={`${prefix}:manufacturers`} label="Other manufacturers (optional)" value={otherManufacturers.join(", ")} placeholder="Add other manufacturers, separated by commas" />
              </div>
              <div className="capability-option-section">
                <div className="capability-option-heading"><b>Product and system types</b><small>Select the technical systems you actively supply.</small></div>
                <div className="capability-option-grid">
                  {systemOptions.map((option) => <OptionCard key={option} name={`${prefix}:system`} value={option} checked={includesCapabilityValue(capability.systemNames, option)} />)}
                </div>
                <Field name={`${prefix}:systems`} label="Other systems (optional)" value={otherSystems.join(", ")} placeholder="Add other system types, separated by commas" />
              </div>
            </> : <div className="form-grid capability-fields">
              <Field name={`${prefix}:manufacturers`} label="Manufacturers" value={capability.manufacturerNames.join(", ")} placeholder="Add manufacturers, separated by commas" />
              <Field name={`${prefix}:systems`} label="Systems or brands" value={capability.systemNames.join(", ")} placeholder="Add systems or brands, separated by commas" />
            </div>}
            {!isPhe && !isTransport ? <div className="capability-option-section">
              <div className="capability-option-heading"><b>Colours supplied</b><small>Tick every standard colour you supply. Tick RAL colours only if you can supply RAL-specified finishes.</small></div>
              <div className="capability-option-grid capability-colour-grid">
                {STANDARD_COLOUR_OPTIONS.map((option) => <OptionCard key={option} name={`${prefix}:colour`} value={option} checked={includesCapabilityValue(capability.colourNames, option)} />)}
                <OptionCard name={`${prefix}:colour`} value={RAL_COLOUR_MARKER} checked={selectedRal} description="Any RAL-specified colour" />
              </div>
              <div className="form-grid">
                <Field name={`${prefix}:ralCodes`} label="Specific RAL codes (optional)" value={ralCodes.join(", ")} placeholder="For example RAL 7016, RAL 9005" />
                <Field name={`${prefix}:otherColours`} label="Other named colours (optional)" value={otherColours.join(", ")} placeholder="Add other colours, separated by commas" />
              </div>
            </div> : null}
            <div className="form-grid capability-fields">
              <Field name={`${prefix}:finishes`} label={isTransport ? "Other handling or service features" : isPhe ? "Technical variants or specifications" : "Finishes supplied"} value={isTransport ? otherTransportFeatures.join(", ") : capability.finishNames.join(", ")} placeholder={isTransport ? "For example fragile loads, evening collections" : isPhe ? "For example low-temperature, potable-water, commercial duty" : "Foil, powder coat, anodised"} />
              <Field name={`${prefix}:minimumQuantity`} label="Minimum order quantity" value={capability.minimumOrderQuantity ?? ""} type="number" min="1" />
              <Field name={`${prefix}:minimumValue`} label="Minimum order value (£)" value={capability.minimumOrderValue ?? ""} type="number" min="0" step="0.01" />
              <Field name={`${prefix}:standardLead`} label={isTransport ? "Standard booking notice (days)" : "Standard lead time (days)"} value={capability.standardLeadTimeDays} type="number" min="1" required />
              <Field name={`${prefix}:currentLead`} label={isTransport ? "Current booking notice (days)" : "Current lead time (days)"} value={capability.currentLeadTimeDays ?? capability.standardLeadTimeDays} type="number" min="1" />
              <Field name={`${prefix}:urgentLead`} label={isTransport ? "Urgent booking notice (days)" : "Urgent lead time (days)"} value={capability.urgentLeadTimeDays ?? ""} type="number" min="1" />
              <Field name={`${prefix}:declaredMonthlyCapacity`} label="Comfortable monthly opportunity capacity" value={capability.declaredMonthlyCapacity ?? ""} type="number" min="1" />
              <label className="form-control"><span>Current capacity</span><select name={`${prefix}:capacity`} value={capacityByCategory[prefix]} onChange={(event) => setCapacityByCategory((current) => ({ ...current, [prefix]: event.target.value as CapacityStatus }))}><option value="AVAILABLE">Available</option><option value="LIMITED">Limited</option><option value="URGENT_ONLY">Urgent work only</option><option value="FULL">Temporarily full</option><option value="PAUSED">Paused</option><option value="HOLIDAY">Holiday</option><option value="NOT_ACCEPTING">Not accepting new work</option></select></label>
              {isTransport ? <>
                <label className="toggle-row"><span><b>Transport service available</b><small>Your vehicle and driver can collect and deliver customer loads</small></span><input type="checkbox" name={`${prefix}:service`} defaultChecked={capability.supportsService}/></label>
                <label className="toggle-row"><span><b>Depot drop-off available</b><small>Customers may bring items to your depot before onward transport</small></span><input type="checkbox" name={`${prefix}:collection`} defaultChecked={capability.collectionAvailable}/></label>
              </> : <>
                <label className="toggle-row"><span><b>Supply only</b><small>You supply products without installation</small></span><input type="checkbox" name={`${prefix}:supplyOnly`} defaultChecked={capability.supportsSupplyOnly}/></label>
                <label className="toggle-row"><span><b>Delivery available</b><small>You can deliver products to the buyer</small></span><input type="checkbox" name={`${prefix}:delivery`} defaultChecked={capability.supportsDelivery}/></label>
                <label className="toggle-row"><span><b>Installation available</b><small>Your team can install this product on site</small></span><input type="checkbox" name={`${prefix}:installation`} defaultChecked={capability.supportsInstallation}/></label>
                <label className="toggle-row"><span><b>On-site service</b><small>Your staff or engineers travel to site</small></span><input type="checkbox" name={`${prefix}:service`} defaultChecked={capability.supportsService}/></label>
                <label className="toggle-row"><span><b>Collection available</b><small>Customers may collect from you</small></span><input type="checkbox" name={`${prefix}:collection`} defaultChecked={capability.collectionAvailable}/></label>
              </>}
              <Field name={`${prefix}:restrictedProducts`} label="Temporarily restricted products" value={capability.restrictedProducts.join(", ")} placeholder="Comma-separated products you cannot currently supply" />
              <Field name={`${prefix}:deliveryDelay`} label="Current delivery delay (days)" value={capability.deliveryDelayDays ?? ""} type="number" min="0" />
              <Field name={`${prefix}:shortageNote`} label="Temporary shortage" value={capability.shortageNote ?? ""} placeholder="Leave blank when there is no shortage" />
              <Field name={`${prefix}:shortageUntil`} label="Shortage expected until" value={capability.shortageUntil?.slice(0, 10) ?? ""} type="date" />
            </div>
            <div className="form-control"><span>{isTransport ? "Normal operating days" : "Normal delivery days"}</span><div className="inline-actions">{dayOptions.map(([day, label]) => <label className="choice-card day-choice" key={day}><input type="checkbox" name={`${prefix}:day:${day}`} defaultChecked={capability.deliveryDays.includes(day)}/><span><b>{label}</b></span></label>)}</div></div>
            <p className="body-copy">Last confirmed: {confirmedByCategory[prefix] ? new Date(confirmedByCategory[prefix]!).toLocaleString("en-GB") : "Not confirmed yet"}</p>
          </div>
        </details>
      </section>;
    })}
    <div className="sticky-save">{message && <p className={`form-result ${error ? "error" : "success"}`}>{!error && <CheckCircle2 size={14}/>} {message}</p>}<button className="button button-dark" disabled={busy || Boolean(activatingId)}>{busy ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>} {busy ? "Saving…" : "Save advanced details"}</button></div>
  </form>;
}

function OptionCard({ name, value, checked, description, label }: { name: string; value: string; checked: boolean; description?: string; label?: string }) {
  return <label className="choice-card capability-option-card">
    <input type="checkbox" name={name} value={value} defaultChecked={checked}/>
    <span><b>{label ?? value}</b>{description ? <small>{description}</small> : null}</span>
  </label>;
}

function Field({ name, label, value, placeholder, type = "text", min, step, required }: { name: string; label: string; value: string | number; placeholder?: string; type?: string; min?: string; step?: string; required?: boolean }) {
  return <label className="form-control"><span>{label}</span><input name={name} defaultValue={value} placeholder={placeholder} type={type} min={min} step={step} required={required}/></label>;
}
