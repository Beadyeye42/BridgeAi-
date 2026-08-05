"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useState } from "react";
import { Bell, CheckCircle2, Globe2, LoaderCircle, LocateFixed, MapPin, Save, Send, Trash2, Users } from "lucide-react";

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

export function CompanyProfileForm({ company, categories, selectedCategoryIds }: { company: Record<string, unknown>; categories: { id: string; name: string; description: string | null }[]; selectedCategoryIds: string[] }) {
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<Feedback>(null);
  const hours = (company.businessHours && typeof company.businessHours === "object" ? company.businessHours : {}) as Record<string, [string, string] | null>;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback(null);
    const data = new FormData(event.currentTarget);
    const businessHours = Object.fromEntries(["monday","tuesday","wednesday","thursday","friday","saturday","sunday"].map((day) => [day, data.get(`${day}Closed`) ? null : [String(data.get(`${day}Open`) || "08:00"), String(data.get(`${day}Close`) || "17:00")]]));
    const body = Object.fromEntries(["legalName","tradingName","companyNumber","vatNumber","websiteUrl","summary","contactEmail","contactPhone","addressLine1","addressLine2","city","county","postcode"].map((name) => [name, String(data.get(name) ?? "")]));
    try { await api("/api/supplier/company", "PATCH", { ...body, businessHours, categoryIds: data.getAll("categoryIds") }); setFeedback({ tone: "success", message: "Company profile saved and audit logged." }); }
    catch (error) { setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Save failed" }); }
    finally { setBusy(false); }
  }
  const value = (name: string) => String(company[name] ?? "");
  return <form className="management-form" onSubmit={submit}>
    <section className="panel form-section" id="company-details"><div className="section-heading"><div><p className="eyebrow">Identity</p><h2>Company details</h2></div><span className={`status-pill ${String(company.status).toLowerCase()}`}>{String(company.status)}</span></div><div className="form-grid"><Field label="Legal company name" name="legalName" value={value("legalName")} required /><Field label="Trading name" name="tradingName" value={value("tradingName")} /><Field label="Company number" name="companyNumber" value={value("companyNumber")} /><Field label="VAT number" name="vatNumber" value={value("vatNumber")} /><Field label="Website" name="websiteUrl" value={value("websiteUrl")} type="url" /><Field label="Quotation email" name="contactEmail" value={value("contactEmail")} type="email" required /><Field label="Contact phone" name="contactPhone" value={value("contactPhone")} required /><label className="form-control span-2"><span>Company summary</span><textarea name="summary" rows={4} defaultValue={value("summary")} maxLength={1500} /></label></div></section>
    <section className="panel form-section" id="product-categories"><div className="section-heading"><div><p className="eyebrow">Matching</p><h2>Products you supply</h2></div></div><p className="body-copy">Select only products your company actively supplies and can quote. Bridge AI uses these exact choices to match enquiries to your business, so do not select products you cannot fulfil.</p><div className="choice-grid">{categories.map((category) => <label className="choice-card" key={category.id}><input type="checkbox" name="categoryIds" value={category.id} defaultChecked={selectedCategoryIds.includes(category.id)} /><span><b>{category.name}</b><small>{category.description}</small></span></label>)}</div></section>
    <section className="panel form-section" id="business-hours"><div className="section-heading"><div><p className="eyebrow">Office</p><h2>Address & business hours</h2></div></div><div className="form-grid"><Field label="Address line 1" name="addressLine1" value={value("addressLine1")} /><Field label="Address line 2" name="addressLine2" value={value("addressLine2")} /><Field label="Town or city" name="city" value={value("city")} /><Field label="County" name="county" value={value("county")} /><Field label="Postcode" name="postcode" value={value("postcode")} /></div><div className="hours-list">{["monday","tuesday","wednesday","thursday","friday","saturday","sunday"].map((day) => <div className="hours-row" key={day}><b>{day}</b><input type="time" name={`${day}Open`} defaultValue={hours[day]?.[0] ?? "08:00"} /><span>to</span><input type="time" name={`${day}Close`} defaultValue={hours[day]?.[1] ?? "17:00"} /><label><input type="checkbox" name={`${day}Closed`} defaultChecked={!hours[day]} /> Closed</label></div>)}</div></section>
    <div className="sticky-save"><Result value={feedback} /><SubmitButton busy={busy} /></div>
  </form>;
}

function Field({ label, name, value, type = "text", required = false }: { label: string; name: string; value: string; type?: string; required?: boolean }) { return <label className="form-control"><span>{label}</span><input name={name} type={type} defaultValue={value} required={required} /></label>; }

export function CoverageManager({ areas }: { areas: { id: string; type: string; label: string; postcodePrefix: string | null; centrePostcode: string | null; radiusMiles: number | null }[] }) {
  const router = useRouter();
  const [type, setType] = useState<"POSTCODE"|"DISTANCE"|"NATIONWIDE">("DISTANCE");
  const [radiusChoice, setRadiusChoice] = useState("40");
  const [depotPostcode, setDepotPostcode] = useState("");
  const [postcodePrefix, setPostcodePrefix] = useState("");
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
        if (type === "POSTCODE") setPostcodePrefix(result.outwardCode);
        else setDepotPostcode(result.postcode);
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
    const body = type === "POSTCODE" ? { type, postcodePrefix: data.get("postcodePrefix") } : type === "DISTANCE" ? { type, centrePostcode: data.get("centrePostcode"), radiusMiles: data.get("radiusMiles") } : { type };
    try {
      const result = await api("/api/supplier/coverage", "POST", body) as { alreadyExists?: boolean };
      setFeedback({ tone:"success", message: result.alreadyExists ? "That supply area is already saved." : "Coverage saved. You are ready to receive matching enquiries." });
      form.reset(); setRadiusChoice("40"); setDepotPostcode(""); setPostcodePrefix(""); router.refresh();
    } catch(e) { setFeedback({tone:"error", message:e instanceof Error ? e.message:"Could not save coverage"}); }
    finally { setBusy(false); }
  }
  async function remove(id: string) { if (!window.confirm("Remove this coverage area?")) return; try { await api(`/api/supplier/coverage/${id}`, "DELETE"); router.refresh(); } catch(e) { setFeedback({tone:"error",message:e instanceof Error?e.message:"Could not remove area"}); } }
  const definition = (area: typeof areas[number]) => area.type === "POSTCODE" ? `Postcode area ${area.postcodePrefix}` : area.type === "NATIONWIDE" ? "All UK delivery postcodes" : `${area.radiusMiles} mile straight-line radius from ${area.centrePostcode}`;
  const locationButton = <><button className="button button-outline" type="button" disabled={busy || locating} onClick={findMyLocation}>{locating ? <LoaderCircle className="spin" size={15}/> : <LocateFixed size={15}/>} {locating ? "Finding your postcode…" : "Use my current location"}</button><small className="body-copy">Your browser will ask for location permission. If it cannot provide your location, enter your postcode below. Bridge AI does not save your exact coordinates.</small></>;
  return <div className="management-grid"><section className="panel form-section"><div className="section-heading"><div><p className="eyebrow">Active coverage</p><h2>Your supply area</h2></div></div><div className="entity-list">{areas.length ? areas.map((area) => <article className="entity-row" key={area.id}><span className="entity-icon">{area.type === "NATIONWIDE" ? <Globe2 size={18}/> : <MapPin size={18}/>}</span><div><b>{area.label}</b><small>{definition(area)}</small></div><button className="icon-button subtle danger" onClick={() => remove(area.id)} aria-label={`Remove ${area.label}`}><Trash2 size={16}/></button></article>) : <div className="empty-state">No supply area saved yet. Add one to start receiving matching enquiries.</div>}</div><p className="body-copy">You can add another depot later. Distances are measured in a straight line from the postcode, not by driving time.</p></section><form className="panel form-section" onSubmit={submit}><div className="section-heading"><div><p className="eyebrow">Set your area</p><h2>Where can you supply?</h2></div></div><div className="segmented"><button type="button" className={type === "DISTANCE"?"active":""} onClick={()=>{setType("DISTANCE");setFeedback(null)}}>Miles from me</button><button type="button" className={type === "NATIONWIDE"?"active":""} onClick={()=>{setType("NATIONWIDE");setFeedback(null)}}>Nationwide</button><button type="button" className={type === "POSTCODE"?"active":""} onClick={()=>{setType("POSTCODE");setFeedback(null)}}>Postcode area</button></div><div className="form-stack">{type === "DISTANCE" ? <>{locationButton}<label className="form-control"><span>Depot postcode</span><input name="centrePostcode" value={depotPostcode} onChange={(event)=>setDepotPostcode(event.target.value)} placeholder="For example B1 1AA" required autoComplete="postal-code" /></label><label className="form-control"><span>How far can you supply?</span><select value={radiusChoice} onChange={(event)=>setRadiusChoice(event.target.value)}><option value="10">Within 10 miles</option><option value="25">Within 25 miles</option><option value="40">Within 40 miles</option><option value="50">Within 50 miles</option><option value="75">Within 75 miles</option><option value="100">Within 100 miles</option><option value="150">Within 150 miles</option><option value="custom">Choose another distance</option></select></label>{radiusChoice === "custom" ? <Field label="Distance in miles (1–500)" name="radiusMiles" value="" type="number" required /> : <input type="hidden" name="radiusMiles" value={radiusChoice}/>}</> : type === "POSTCODE" ? <>{locationButton}<label className="form-control"><span>Full postcode or postcode area</span><input name="postcodePrefix" value={postcodePrefix} onChange={(event)=>setPostcodePrefix(event.target.value)} placeholder="For example GL52 6TD, B or CV" required autoComplete="postal-code" /></label><small className="body-copy">A full postcode is automatically converted to its local postcode area.</small></> : <p className="body-copy">Choose this if you can supply anywhere in the United Kingdom.</p>}<Result value={feedback}/><SubmitButton busy={busy || locating} label={type === "NATIONWIDE" ? "Use nationwide coverage" : "Save supply area"} /></div></form></div>;
}

export function NotificationForm({ preference }: { preference: Record<string, unknown> }) { const [busy,setBusy]=useState(false); const [feedback,setFeedback]=useState<Feedback>(null); async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);const data=new FormData(event.currentTarget);try{await api("/api/supplier/notifications","PATCH",{emailNewRequests:data.has("emailNewRequests"),emailRequestReminders:data.has("emailRequestReminders"),emailQuotationUpdates:data.has("emailQuotationUpdates"),smsUrgentRequests:data.has("smsUrgentRequests"),inAppEnabled:data.has("inAppEnabled"),quietHoursStart:String(data.get("quietHoursStart")||"")||null,quietHoursEnd:String(data.get("quietHoursEnd")||"")||null});setFeedback({tone:"success",message:"Notification preferences saved."});}catch(e){setFeedback({tone:"error",message:e instanceof Error?e.message:"Save failed"});}finally{setBusy(false)}} return <form className="panel form-section settings-width" onSubmit={submit}><div className="section-heading"><div><p className="eyebrow">Channels</p><h2>Notification preferences</h2></div><Bell size={20}/></div><div className="toggle-list">{[["emailNewRequests","New quote requests","Email me when a matching request arrives"],["emailRequestReminders","Deadline reminders","Email me before response windows close"],["emailQuotationUpdates","Quotation outcomes","Email me when a quotation is won or lost"],["smsUrgentRequests","Urgent SMS alerts","Text me for requests with short deadlines"],["inAppEnabled","In-app notifications","Show updates in this portal"]].map(([name,title,copy])=><label className="toggle-row" key={name}><span><b>{title}</b><small>{copy}</small></span><input type="checkbox" name={name} defaultChecked={Boolean(preference[name])}/></label>)}</div><div className="quiet-hours"><div><b>Quiet hours</b><small>Non-urgent delivery is held during this period.</small></div><input type="time" name="quietHoursStart" defaultValue={String(preference.quietHoursStart??"")}/><span>to</span><input type="time" name="quietHoursEnd" defaultValue={String(preference.quietHoursEnd??"")}/></div><div className="form-actions"><Result value={feedback}/><SubmitButton busy={busy}/></div></form> }

export function TeamInviteForm() { const router=useRouter(); const [busy,setBusy]=useState(false); const [feedback,setFeedback]=useState<Feedback>(null); async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);const form=event.currentTarget;const data=new FormData(form);try{const result=await api("/api/supplier/team/invites","POST",{email:data.get("email"),role:data.get("role")});setFeedback({tone:"success",message:result.delivered?"Invitation email sent.":"Invitation created. Email delivery is not configured in this environment."});form.reset();router.refresh()}catch(e){setFeedback({tone:"error",message:e instanceof Error?e.message:"Invite failed"})}finally{setBusy(false)}} return <form className="panel form-section" onSubmit={submit}><div className="section-heading"><div><p className="eyebrow">Add a colleague</p><h2>Invite team member</h2></div><Users size={20}/></div><div className="form-stack"><Field label="Business email" name="email" type="email" value="" required/><label className="form-control"><span>Workspace role</span><select name="role"><option value="MEMBER">Member</option><option value="MANAGER">Manager</option></select></label><Result value={feedback}/><button className="button button-dark" disabled={busy}>{busy?<LoaderCircle className="spin" size={15}/>:<Send size={15}/>}Send invitation</button></div></form> }

export function LogoUpload({hasLogo}:{hasLogo:boolean}){const router=useRouter();const[busy,setBusy]=useState(false);const[confirmDelete,setConfirmDelete]=useState(false);const[feedback,setFeedback]=useState<Feedback>(null);async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);const form=new FormData(e.currentTarget);try{const r=await fetch("/api/uploads/logo",{method:"POST",body:form});const j=await r.json();if(!r.ok)throw new Error(j.error);setFeedback({tone:"success",message:hasLogo?"Logo replaced and queued for security scanning.":"Logo uploaded and queued for security scanning."});router.refresh()}catch(error){setFeedback({tone:"error",message:error instanceof Error?error.message:"Upload failed"})}finally{setBusy(false)}}async function remove(){setBusy(true);try{await api("/api/uploads/logo","DELETE");setConfirmDelete(false);setFeedback({tone:"success",message:"Company logo deleted."});router.refresh()}catch(error){setFeedback({tone:"error",message:error instanceof Error?error.message:"Delete failed"})}finally{setBusy(false)}}return <form className="panel logo-upload" onSubmit={submit}><div className="logo-preview">{hasLogo?<Image src="/api/supplier/logo" alt="Current company logo" width={76} height={76} unoptimized/>:<span>LOGO</span>}</div><div><b>Company logo</b><p>PNG, JPEG or WebP, up to 2 MB. New files are held until security checks pass.</p><input name="file" type="file" accept="image/png,image/jpeg,image/webp" required/><Result value={feedback}/></div><div className="inline-actions"><button className="button button-outline" disabled={busy}>{busy?<LoaderCircle className="spin" size={14}/>:<Save size={14}/>}{hasLogo?"Replace":"Upload"}</button>{hasLogo&&!confirmDelete&&<button className="button button-outline" type="button" disabled={busy} onClick={()=>setConfirmDelete(true)}><Trash2 size={14}/>Delete</button>}{hasLogo&&confirmDelete&&<><button className="button button-outline" type="button" disabled={busy} onClick={remove}>Confirm delete</button><button className="button button-outline" type="button" disabled={busy} onClick={()=>setConfirmDelete(false)}>Cancel</button></>}</div></form>}

export function TeamMemberActions({membershipId,role}:{membershipId:string;role:string}){const router=useRouter();const[busy,setBusy]=useState(false);async function change(next:string){setBusy(true);try{await api(`/api/supplier/team/members/${membershipId}`,"PATCH",{role:next});router.refresh()}finally{setBusy(false)}}async function remove(){if(!window.confirm("Remove this person from the workspace and revoke their sessions?"))return;setBusy(true);try{await api(`/api/supplier/team/members/${membershipId}`,"DELETE");router.refresh()}finally{setBusy(false)}}return <div className="inline-actions"><select aria-label="Team role" value={role} disabled={busy} onChange={e=>change(e.target.value)}><option value="MEMBER">Member</option><option value="MANAGER">Manager</option></select><button className="icon-button subtle danger" disabled={busy} onClick={remove} aria-label="Remove team member"><Trash2 size={15}/></button></div>}
