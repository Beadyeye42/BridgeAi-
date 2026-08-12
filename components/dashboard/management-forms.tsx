"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useMemo, useState } from "react";
import { Bell, CalendarDays, CheckCircle2, Globe2, LoaderCircle, LocateFixed, MapPin, PackageCheck, Save, Send, Trash2, Users } from "lucide-react";

type Feedback = { tone: "success" | "error"; message: string } | null;

async function api(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "The request could not be completed");
  return result;
}

function SubmitButton({ busy, label = "Save changes" }: { busy: boolean; label?: string }) {
  return <button className="button button-dark" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}{busy ? "Saving…" : label}</button>;
}

function Result({ value }: { value: Feedback }) {
  if (!value) return null;
  return <p className={`form-result ${value.tone}`}>{value.tone === "success" && <CheckCircle2 size={14} />}{value.message}</p>;
}

export function CompanyProfileForm({ company, categories, selectedCategoryIds }: { company: Record<string, unknown>; categories: { id: string; name: string; description: string | null; groupName: string }[]; selectedCategoryIds: string[] }) {
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<Feedback>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback(null);
    const data = new FormData(event.currentTarget);
    const body = Object.fromEntries(["legalName","companyNumber","directorName","contactEmail","contactPhone","addressLine1","addressLine2","city","county","postcode"].map((name) => [name, String(data.get(name) ?? "")]));
    try { await api("/api/supplier/company", "PATCH", { ...body, categoryIds: data.getAll("categoryIds") }); setFeedback({ tone: "success", message: "Company profile saved and audit logged." }); }
    catch (error) { setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Save failed" }); }
    finally { setBusy(false); }
  }
  const value = (name: string) => String(company[name] ?? "");
  return <form className="management-form" onSubmit={submit}>
    <section className="panel form-section" id="company-details"><div className="section-heading"><div><p className="eyebrow">Supplier application</p><h2>Company details</h2></div><span className={`status-pill ${String(company.status).toLowerCase()}`}>{String(company.status)}</span></div><p className="body-copy">These are the only company details Bridge AI needs for approval. Public-liability insurance is not required.</p><div className="form-grid"><Field label="Legal company name" name="legalName" value={value("legalName")} required /><Field label="Companies House number" name="companyNumber" value={value("companyNumber")} required /><Field label="Director's full name" name="directorName" value={value("directorName")} required /><Field label="Company phone number" name="contactPhone" value={value("contactPhone")} required /><Field label="Company email" name="contactEmail" value={value("contactEmail")} type="email" required /></div></section>
    <section className="panel form-section" id="company-address"><div className="section-heading"><div><p className="eyebrow">Registered or principal office</p><h2>Company address</h2></div></div><div className="form-grid"><Field label="Address line 1" name="addressLine1" value={value("addressLine1")} required /><Field label="Address line 2 (optional)" name="addressLine2" value={value("addressLine2")} /><Field label="Town or city" name="city" value={value("city")} required /><Field label="County (optional)" name="county" value={value("county")} /><Field label="Postcode" name="postcode" value={value("postcode")} required /></div></section>
    <section className="panel form-section" id="product-categories"><div className="section-heading"><div><p className="eyebrow">Industry setup</p><h2>Choose your industry and products</h2></div></div><p className="body-copy">Start with the industry your business serves, then select only the products you actively supply and can quote. Your capability screen will adapt to those choices with the right brands, systems and technical fields.</p>{Array.from(new Set(categories.map((category) => category.groupName))).map((groupName) => <div className="category-group" key={groupName}><p className="eyebrow">Industry</p><h3>{groupName}</h3><p className="body-copy">{groupName === "Plumbing, heating and mechanical" ? "Choose the heating, hot-water, pipework, controls or mechanical packages your company supplies." : "Choose every product in this industry that your company can confidently quote."}</p><div className="choice-grid">{categories.filter((category) => category.groupName === groupName).map((category) => <label className="choice-card" key={category.id}><input type="checkbox" name="categoryIds" value={category.id} defaultChecked={selectedCategoryIds.includes(category.id)} /><span><b>{category.name}</b><small>{category.description}</small></span></label>)}</div></div>)}</section>
    <div className="sticky-save"><Result value={feedback} /><SubmitButton busy={busy} /></div>
  </form>;
}

function Field({ label, name, value, type = "text", required = false }: { label: string; name: string; value: string; type?: string; required?: boolean }) { return <label className="form-control"><span>{label}</span><input name={name} type={type} defaultValue={value} required={required} /></label>; }

type CoverageView = { id: string; type: string; purpose: "SERVICE" | "DELIVERY"; label: string; postcodePrefix: string | null; centrePostcode: string | null; radiusMiles: number | null };
type CollectionView = { id: string; label: string; postcode: string; collectionDays: number[]; noticeRequired: boolean; noticeHours: number | null };
type CoveragePlanView = { name: string; tier: string; maximumRadiusMiles: number | null; maximumServiceRadiusMiles: number | null; maximumDeliveryRadiusMiles: number | null; nationwideAllowed: boolean; maximumActiveOpportunities: number; onboardingDefault: boolean } | null;

export function CoverageManager({ areas, collections, plan, companyBasePostcode }: { areas: CoverageView[]; collections: CollectionView[]; plan: CoveragePlanView; companyBasePostcode: string }) {
  const router = useRouter();
  const [type, setType] = useState<"DISTANCE"|"NATIONWIDE">("DISTANCE");
  const [purpose, setPurpose] = useState<"SERVICE"|"DELIVERY">("DELIVERY");
  const purposeRadius = purpose === "SERVICE" ? plan?.maximumServiceRadiusMiles : plan?.maximumDeliveryRadiusMiles;
  const radiusOptions = useMemo(
    () => [5, 10, 15, 25, 40, 50, 75, 100].filter((value) => purposeRadius === null || value <= (purposeRadius ?? 40)),
    [purposeRadius],
  );
  const defaultRadius = String(radiusOptions.at(-1) ?? 40);
  const [radiusChoice, setRadiusChoice] = useState(defaultRadius);
  const [depotPostcode, setDepotPostcode] = useState(companyBasePostcode);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  function findMyLocation() {
    setFeedback(null);
    if (!("geolocation" in navigator)) {
      setFeedback({ tone: "error", message: "Location is not available in this browser. Enter your postcode instead." });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const result = await api("/api/supplier/location/postcode", "POST", { latitude: position.coords.latitude, longitude: position.coords.longitude }) as { postcode: string; outwardCode: string };
        setDepotPostcode(result.postcode);
        setFeedback({ tone: "success", message: `Location found: ${result.postcode}.` });
      } catch (error) {
        setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Your postcode could not be found" });
      } finally {
        setLocating(false);
      }
    }, (error) => {
      const message = error.code === error.PERMISSION_DENIED ? "Location permission was not granted. Enter your postcode instead." : "Your location could not be found. Enter your postcode instead.";
      setFeedback({ tone: "error", message });
      setLocating(false);
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = type === "DISTANCE" ? { type, purpose, centrePostcode: data.get("centrePostcode"), radiusMiles: data.get("radiusMiles") } : { type, purpose };
    try {
      const result = await api("/api/supplier/coverage", "POST", body) as { alreadyExists?: boolean };
      setFeedback({ tone:"success", message: result.alreadyExists ? "That area is already saved." : `${purpose === "SERVICE" ? "Service" : "Delivery"} coverage saved.` });
      form.reset(); setRadiusChoice(defaultRadius); setDepotPostcode(companyBasePostcode); router.refresh();
    } catch(e) { setFeedback({tone:"error", message:e instanceof Error ? e.message:"Could not save coverage"}); }
    finally { setBusy(false); }
  }
  async function remove(id: string) { if (!window.confirm("Remove this coverage area?")) return; try { await api(`/api/supplier/coverage/${id}`, "DELETE"); router.refresh(); } catch(e) { setFeedback({tone:"error",message:e instanceof Error?e.message:"Could not remove area"}); } }
  async function removeCollection(id: string) { if (!window.confirm("Remove this collection location?")) return; try { await api(`/api/supplier/collection-locations/${id}`, "DELETE"); router.refresh(); } catch(e) { setFeedback({tone:"error",message:e instanceof Error?e.message:"Could not remove collection location"}); } }
  async function addCollection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback(null);
    const form = event.currentTarget; const data = new FormData(form); const noticeRequired = data.has("noticeRequired");
    try {
      await api("/api/supplier/collection-locations", "POST", { label: data.get("label"), postcode: data.get("postcode"), collectionDays: data.getAll("collectionDays").map(Number), noticeRequired, noticeHours: noticeRequired ? Number(data.get("noticeHours")) : null });
      setFeedback({ tone: "success", message: "Collection location saved." }); form.reset(); router.refresh();
    } catch (error) { setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Could not save collection location" }); }
    finally { setBusy(false); }
  }
  const definition = (area: typeof areas[number]) => area.type === "POSTCODE" ? `Postcode area ${area.postcodePrefix}` : area.type === "NATIONWIDE" ? "All UK delivery postcodes" : `${area.radiusMiles} mile straight-line radius from ${area.centrePostcode}`;
  const locationButton = <><button className="button button-outline" type="button" disabled={busy || locating} onClick={findMyLocation}>{locating ? <LoaderCircle className="spin" size={15}/> : <LocateFixed size={15}/>} {locating ? "Finding your postcode…" : "Use my current location"}</button><small className="body-copy">Your browser will ask for location permission. If it cannot provide your location, enter your postcode below. Bridge AI does not save your exact coordinates.</small></>;
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return <div className="management-form">
    <section className="panel form-section"><div className="section-heading"><div><p className="eyebrow">{plan?.onboardingDefault ? "Onboarding before billing" : "Your membership boundary"}</p><h2>{plan?.onboardingDefault ? "Set your operating area now" : plan?.name ?? "Membership not configured"}</h2></div><Globe2 size={20}/></div><p className="body-copy">{plan?.onboardingDefault ? `You can save service, delivery and collection locations before choosing a plan. During onboarding, coverage is limited to ${plan.maximumRadiusMiles ?? 40} miles. You can expand it after activating a wider plan.` : <>{plan?.nationwideAllowed ? "You may choose nationwide eligibility." : `You may choose any radius up to ${plan?.maximumRadiusMiles ?? 40} miles.`} Your chosen area can be smaller. Service and delivery rules never replace each other.</>}</p><div className="detail-grid"><div><dt>{plan?.onboardingDefault ? "Onboarding limit" : "Tier"}</dt><dd>{plan?.onboardingDefault ? `${plan.maximumRadiusMiles ?? 40} miles` : plan?.tier ?? "—"}</dd></div><div><dt>Lead access</dt><dd>{plan?.onboardingDefault ? "Requires approval & active plan" : `Up to ${plan?.maximumActiveOpportunities ?? 0} active`}</dd></div></div></section>
    <div className="management-grid"><section className="panel form-section"><div className="section-heading"><div><p className="eyebrow">Active matching areas</p><h2>Your geography</h2></div></div><div className="entity-list">{areas.length ? areas.map((area) => <article className="entity-row" key={area.id}><span className="entity-icon">{area.type === "NATIONWIDE" ? <Globe2 size={18}/> : <MapPin size={18}/>}</span><div><b>{area.label}</b><small>{area.purpose === "SERVICE" ? "Service / installation" : "Product delivery"} · {definition(area)}</small></div><button className="icon-button subtle danger" type="button" onClick={() => remove(area.id)} aria-label={`Remove ${area.label}`}><Trash2 size={16}/></button></article>) : <div className="empty-state">No matching area saved yet.</div>}</div><p className="body-copy">Distances use straight-line postcode distance. They are not driving-time estimates.</p></section>
    <form className="panel form-section" onSubmit={submit}><div className="section-heading"><div><p className="eyebrow">Add coverage</p><h2>Choose one clear rule</h2></div></div><label className="form-control"><span>What is this area for?</span><select value={purpose} onChange={(event)=>{const next=event.target.value as "SERVICE"|"DELIVERY";const nextLimit=next === "SERVICE" ? plan?.maximumServiceRadiusMiles : plan?.maximumDeliveryRadiusMiles;const nextOptions=[5,10,15,25,40,50,75,100].filter((value)=>nextLimit === null || value <= (nextLimit ?? 40));setPurpose(next);setRadiusChoice(String(nextOptions.at(-1) ?? 40));}}><option value="SERVICE">Service or installation work</option><option value="DELIVERY">Product deliveries</option></select></label><div className="segmented"><button type="button" className={type === "DISTANCE"?"active":""} onClick={()=>setType("DISTANCE")}>Radius from company base</button>{plan?.nationwideAllowed && <button type="button" className={type === "NATIONWIDE"?"active":""} onClick={()=>setType("NATIONWIDE")}>Nationwide</button>}</div><div className="form-stack">{type === "DISTANCE" ? <>{locationButton}<label className="form-control"><span>Operating postcode</span><input name="centrePostcode" value={depotPostcode} onChange={(event)=>setDepotPostcode(event.target.value)} placeholder="For example GL52 6TD" required autoComplete="postal-code" /></label><small className="body-copy">Your registered company base is {companyBasePostcode || "not saved yet"}. Every coverage boundary is checked from that postcode.</small><label className="form-control"><span>Maximum distance</span><select value={radiusChoice} onChange={(event)=>setRadiusChoice(event.target.value)}>{radiusOptions.map((value)=><option value={value} key={value}>Within {value} miles</option>)}</select></label><input type="hidden" name="radiusMiles" value={radiusChoice}/><small className="body-copy">{plan?.onboardingDefault ? "This setup can be saved before payment. It does not activate lead access until your company is approved and a plan is active." : "The complete area must remain inside your membership boundary from your registered company base."}</small></> : <p className="body-copy">This makes you eligible across Great Britain, but exact product, capability, lead-time and capacity filters still apply.</p>}<Result value={feedback}/><SubmitButton busy={busy || locating} label="Save matching area" /></div></form></div>
    <div className="management-grid"><section className="panel form-section"><div className="section-heading"><div><p className="eyebrow">Buyer collection</p><h2>Collection locations</h2></div><PackageCheck size={20}/></div><div className="entity-list">{collections.length ? collections.map((location)=><article className="entity-row" key={location.id}><span className="entity-icon"><MapPin size={18}/></span><div><b>{location.label}</b><small>{location.postcode} · {location.collectionDays.map((day)=>dayNames[day-1]).join(", ") || "Days by arrangement"}{location.noticeRequired ? ` · ${location.noticeHours}h notice` : ""}</small></div><button className="icon-button subtle danger" type="button" onClick={()=>removeCollection(location.id)} aria-label={`Remove ${location.label}`}><Trash2 size={16}/></button></article>) : <div className="empty-state">No collection location added.</div>}</div></section>
    <form className="panel form-section" onSubmit={addCollection}><div className="section-heading"><div><p className="eyebrow">Optional fulfilment</p><h2>Add a collection point</h2></div><CalendarDays size={20}/></div><div className="form-stack"><Field label="Location name" name="label" value="" required/><Field label="Collection postcode" name="postcode" value="" required/><div className="choice-grid">{dayNames.map((day,index)=><label className="choice-card" key={day}><input type="checkbox" name="collectionDays" value={index+1}/><span><b>{day}</b></span></label>)}</div><label className="toggle-row"><span><b>Notice required</b><small>Buyer must arrange collection in advance</small></span><input type="checkbox" name="noticeRequired"/></label><Field label="Notice in hours (only if required)" name="noticeHours" value="" type="number"/><Result value={feedback}/><SubmitButton busy={busy} label="Save collection point"/></div></form></div>
  </div>;
}

export function NotificationForm({ preference }: { preference: Record<string, unknown> }) { const [busy,setBusy]=useState(false); const [feedback,setFeedback]=useState<Feedback>(null); async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);const data=new FormData(event.currentTarget);try{await api("/api/supplier/notifications","PATCH",{emailNewRequests:data.has("emailNewRequests"),emailRequestReminders:data.has("emailRequestReminders"),emailQuotationUpdates:data.has("emailQuotationUpdates"),smsUrgentRequests:data.has("smsUrgentRequests"),inAppEnabled:data.has("inAppEnabled"),quietHoursStart:String(data.get("quietHoursStart")||"")||null,quietHoursEnd:String(data.get("quietHoursEnd")||"")||null});setFeedback({tone:"success",message:"Notification preferences saved."});}catch(e){setFeedback({tone:"error",message:e instanceof Error?e.message:"Save failed"});}finally{setBusy(false)}} return <form className="panel form-section settings-width" onSubmit={submit}><div className="section-heading"><div><p className="eyebrow">Channels</p><h2>Notification preferences</h2></div><Bell size={20}/></div><div className="toggle-list">{[["emailNewRequests","New quote requests","Email me when a matching request arrives"],["emailRequestReminders","Deadline reminders","Email me before response windows close"],["emailQuotationUpdates","Quotation outcomes","Email me when a quotation is selected or not selected"],["smsUrgentRequests","Urgent SMS alerts","Text me for requests with short deadlines"],["inAppEnabled","In-app notifications","Show updates in this portal"]].map(([name,title,copy])=><label className="toggle-row" key={name}><span><b>{title}</b><small>{copy}</small></span><input type="checkbox" name={name} defaultChecked={Boolean(preference[name])}/></label>)}</div><div className="quiet-hours"><div><b>Quiet hours</b><small>Non-urgent delivery is held during this period.</small></div><input type="time" name="quietHoursStart" defaultValue={String(preference.quietHoursStart??"")}/><span>to</span><input type="time" name="quietHoursEnd" defaultValue={String(preference.quietHoursEnd??"")}/></div><div className="form-actions"><Result value={feedback}/><SubmitButton busy={busy}/></div></form> }

export function TeamInviteForm() { const router=useRouter(); const [busy,setBusy]=useState(false); const [feedback,setFeedback]=useState<Feedback>(null); async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);const form=event.currentTarget;const data=new FormData(form);try{const result=await api("/api/supplier/team/invites","POST",{email:data.get("email"),role:data.get("role")});setFeedback({tone:"success",message:result.delivered?"Invitation email sent.":"Invitation created. Email delivery is not configured in this environment."});form.reset();router.refresh()}catch(e){setFeedback({tone:"error",message:e instanceof Error?e.message:"Invite failed"})}finally{setBusy(false)}} return <form className="panel form-section" onSubmit={submit}><div className="section-heading"><div><p className="eyebrow">Add a colleague</p><h2>Invite team member</h2></div><Users size={20}/></div><div className="form-stack"><Field label="Business email" name="email" type="email" value="" required/><label className="form-control"><span>Workspace role</span><select name="role"><option value="MEMBER">Member</option><option value="MANAGER">Manager</option></select></label><Result value={feedback}/><button className="button button-dark" disabled={busy}>{busy?<LoaderCircle className="spin" size={15}/>:<Send size={15}/>}Send invitation</button></div></form> }

export function LogoUpload({hasLogo}:{hasLogo:boolean}){const router=useRouter();const[busy,setBusy]=useState(false);const[confirmDelete,setConfirmDelete]=useState(false);const[feedback,setFeedback]=useState<Feedback>(null);async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);const form=new FormData(e.currentTarget);try{const r=await fetch("/api/uploads/logo",{method:"POST",body:form});const j=await r.json();if(!r.ok)throw new Error(j.error);setFeedback({tone:"success",message:hasLogo?"Logo replaced and queued for security scanning.":"Logo uploaded and queued for security scanning."});router.refresh()}catch(error){setFeedback({tone:"error",message:error instanceof Error?error.message:"Upload failed"})}finally{setBusy(false)}}async function remove(){setBusy(true);try{await api("/api/uploads/logo","DELETE");setConfirmDelete(false);setFeedback({tone:"success",message:"Company logo deleted."});router.refresh()}catch(error){setFeedback({tone:"error",message:error instanceof Error?error.message:"Delete failed"})}finally{setBusy(false)}}return <form className="panel logo-upload" onSubmit={submit}><div className="logo-preview">{hasLogo?<Image src="/api/supplier/logo" alt="Current company logo" width={76} height={76} unoptimized/>:<span>LOGO</span>}</div><div><b>Company logo</b><p>PNG, JPEG or WebP, up to 2 MB. New files are held until security checks pass.</p><input name="file" type="file" accept="image/png,image/jpeg,image/webp" required/><Result value={feedback}/></div><div className="inline-actions"><button className="button button-outline" disabled={busy}>{busy?<LoaderCircle className="spin" size={14}/>:<Save size={14}/>}{hasLogo?"Replace":"Upload"}</button>{hasLogo&&!confirmDelete&&<button className="button button-outline" type="button" disabled={busy} onClick={()=>setConfirmDelete(true)}><Trash2 size={14}/>Delete</button>}{hasLogo&&confirmDelete&&<><button className="button button-outline" type="button" disabled={busy} onClick={remove}>Confirm delete</button><button className="button button-outline" type="button" disabled={busy} onClick={()=>setConfirmDelete(false)}>Cancel</button></>}</div></form>}

export function TeamMemberActions({membershipId,role}:{membershipId:string;role:string}){const router=useRouter();const[busy,setBusy]=useState(false);async function change(next:string){setBusy(true);try{await api(`/api/supplier/team/members/${membershipId}`,"PATCH",{role:next});router.refresh()}finally{setBusy(false)}}async function remove(){if(!window.confirm("Remove this person from the workspace and revoke their sessions?"))return;setBusy(true);try{await api(`/api/supplier/team/members/${membershipId}`,"DELETE");router.refresh()}finally{setBusy(false)}}return <div className="inline-actions"><select aria-label="Team role" value={role} disabled={busy} onChange={e=>change(e.target.value)}><option value="MEMBER">Member</option><option value="MANAGER">Manager</option></select><button className="icon-button subtle danger" disabled={busy} onClick={remove} aria-label="Remove team member"><Trash2 size={15}/></button></div>}
