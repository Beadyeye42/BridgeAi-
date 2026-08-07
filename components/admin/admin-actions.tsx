"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Gift, ImageIcon, LoaderCircle, Plus, RotateCcw, Send, ShieldAlert, XCircle } from "lucide-react";
async function call(url:string,method:string,body:unknown){const r=await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error??"Action failed");return j}
export function SupplierStatusControl({id,status,approvalReady=true,approvalBlockers=[]}:{id:string;status:string;approvalReady?:boolean;approvalBlockers?:string[]}){const router=useRouter();const[busy,setBusy]=useState(false);const[message,setMessage]=useState("");async function update(next:string){const note=next==="SUSPENDED"?window.prompt("Suspension reason (required for audit context)")??"":undefined;if(next==="SUSPENDED"&&!note)return;setBusy(true);setMessage("");try{await call(`/api/admin/suppliers/${id}/status`,"PATCH",{status:next,note});router.refresh()}catch(e){setMessage(e instanceof Error?e.message:"Action failed")}finally{setBusy(false)}}return <div className="status-control"><div className="inline-actions">{status!=="APPROVED"&&<button className="button button-dark" disabled={busy||!approvalReady} title={!approvalReady?`Incomplete: ${approvalBlockers.join(", ")}`:undefined} onClick={()=>update("APPROVED")}><Check size={14}/>Approve</button>}{status!=="SUSPENDED"&&<button className="button button-outline danger" disabled={busy} onClick={()=>update("SUSPENDED")}><ShieldAlert size={14}/>Suspend</button>}{busy&&<LoaderCircle className="spin" size={16}/>}</div>{!approvalReady&&status!=="APPROVED"&&<small className="approval-blocked">Complete {approvalBlockers.join(", ")} before approval.</small>}{message&&<small className="error-text">{message}</small>}</div>}

export function RetryWhatsAppJobButton({id,retrySafe}:{id:string;retrySafe:boolean}){const router=useRouter();const[busy,setBusy]=useState(false);const[message,setMessage]=useState("");return <div className="status-control"><button className="button button-outline" disabled={busy||!retrySafe} title={retrySafe?"Retry this idempotent background action":"Automatic retry is blocked because delivery could already have occurred"} onClick={async()=>{setBusy(true);setMessage("");try{const result=await call(`/api/admin/system/jobs/${id}/retry`,"POST",{});setMessage(result.status==="COMPLETED"?"Retried successfully.":`Retry finished with status ${String(result.status).toLowerCase()}.`);router.refresh()}catch(error){setMessage(error instanceof Error?error.message:"Retry failed")}finally{setBusy(false)}}}>{busy?<LoaderCircle className="spin" size={14}/>:<RotateCcw size={14}/>}Retry</button>{message&&<small className="form-result">{message}</small>}</div>}
export function SanitizeAttachmentButton({id}:{id:string}){const router=useRouter();const[busy,setBusy]=useState(false);const[message,setMessage]=useState("");return <div className="attachment-scan-action"><button className="button button-outline" disabled={busy} onClick={async()=>{setBusy(true);setMessage("");try{await call(`/api/admin/attachments/${id}/sanitize`,"POST",{});router.refresh()}catch(error){setMessage(error instanceof Error?error.message:"Image processing failed")}finally{setBusy(false)}}}>{busy?<LoaderCircle className="spin" size={13}/>:<ImageIcon size={13}/>}Make image available</button>{message&&<small className="error-text">{message}</small>}</div>}
export function AssignmentForm({requestId,distributionLimit,currentCount,responseDueAt,suppliers}:{requestId:string;distributionLimit:number;currentCount:number;responseDueAt:string;suppliers:{id:string;name:string;postcode:string|null;matchDescription:string}[]}){const router=useRouter();const[busy,setBusy]=useState(false);const[message,setMessage]=useState("");async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);const d=new FormData(e.currentTarget);try{const result=await call("/api/admin/assignments","POST",{quoteRequestId:requestId,supplierCompanyIds:d.getAll("supplierIds")});setMessage(`${result.created} supplier assignment(s) created.`);router.refresh()}catch(err){setMessage(err instanceof Error?err.message:"Assignment failed")}finally{setBusy(false)}}return <form className="assign-form" onSubmit={submit}><div className="assignment-limit"><b>{currentCount} / {Math.min(distributionLimit,3)}</b><span>supplier slots used · maximum three</span></div>{suppliers.length?<div className="choice-grid compact">{suppliers.map(s=><label className="choice-card" key={s.id}><input type="checkbox" name="supplierIds" value={s.id}/><span><b>{s.name}</b><small>{s.matchDescription}{s.postcode?` · office ${s.postcode}`:""}</small></span></label>)}</div>:<div className="empty-state">No supplier currently passes the capability, capacity, subscription and coverage checks.</div>}<div className="form-control"><span>Shared supplier response deadline</span><b>{responseDueAt}</b><small>Response time pauses Friday at 3:00 pm and resumes Monday at 8:00 am (UK time).</small></div><button className="button button-dark" disabled={busy||!suppliers.length||currentCount>=Math.min(distributionLimit,3)}>{busy?<LoaderCircle className="spin" size={14}/>:<Send size={14}/>}Assign selected</button>{message&&<p className="form-result">{message}</p>}</form>}
export function RecordCustomerSelection({quotationId}:{quotationId:string}){const router=useRouter();const[busy,setBusy]=useState(false);const[message,setMessage]=useState("");async function select(){const evidence=window.prompt("Enter the WhatsApp message ID or a short audit reference proving the customer selected this quote")?.trim();if(!evidence)return;setBusy(true);setMessage("");try{await call(`/api/admin/quotations/${quotationId}/select`,"POST",{evidence});setMessage("Selection recorded. Both parties can now see the relevant contact details; no winning fee is due.");router.refresh()}catch(error){setMessage(error instanceof Error?error.message:"Selection failed")}finally{setBusy(false)}}return <div className="inline-actions"><button className="button button-dark" disabled={busy} onClick={select}>{busy?<LoaderCircle className="spin" size={14}/>:<Check size={14}/>}Record customer selection</button>{message&&<small>{message}</small>}</div>}
function CategoryCreateForm({ parentId, title, copy, successMessage }: { parentId: string | null; title: string; copy: string; successMessage: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await call("/api/admin/categories", "POST", {
        name: data.get("name"), description: data.get("description"), parentId,
      });
      form.reset();
      setMessage(successMessage);
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Create failed"); }
    finally { setBusy(false); }
  }
  return <form className="panel form-section industry-create-form" onSubmit={submit}>
    <div className="section-heading"><div><p className="eyebrow">Catalogue</p><h2>{title}</h2></div><Plus size={20}/></div>
    <div className="form-stack">
      <div className="honesty-note">{copy}</div>
      <label className="form-control"><span>Name</span><input name="name" required/></label>
      <label className="form-control"><span>Description</span><textarea name="description" rows={3}/></label>
      <button className="button button-dark" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14}/> : <Plus size={14}/>}Create</button>
      {message && <p className="form-result">{message}</p>}
    </div>
  </form>;
}

export function IndustryCreateForm() {
  return <CategoryCreateForm
    parentId={null}
    title="Add a new industry"
    copy="New industries are always created offline. Build their products and specialist experience first, then launch the whole industry with one switch."
    successMessage="Industry created offline. Open it to add products and prepare its specialist experience."
  />;
}

export function ProductCreateForm({ parentId, industryName }: { parentId: string; industryName: string }) {
  return <CategoryCreateForm
    parentId={parentId}
    title="Add a product"
    copy={`This product will belong only to ${industryName} and starts turned off. Enable it after its questions and matching details are ready.`}
    successMessage={`Product added to ${industryName} and kept offline until you turn it on.`}
  />;
}
export function ResolveEventButton({id}:{id:string}){const router=useRouter();const[busy,setBusy]=useState(false);return <button className="button button-outline" disabled={busy} onClick={async()=>{setBusy(true);try{await call(`/api/admin/system/${id}/resolve`,"POST",{});router.refresh()}finally{setBusy(false)}}}>{busy?<LoaderCircle className="spin" size={14}/>:<Check size={14}/>}Resolve</button>}
export function RunProductionMonitoringButton(){const router=useRouter();const[busy,setBusy]=useState(false);const[message,setMessage]=useState("");return <div className="status-control"><button className="button button-dark" disabled={busy} onClick={async()=>{setBusy(true);setMessage("");try{const result=await call("/api/admin/system/monitor","POST",{});setMessage(result.configured?`${result.sent} alert${result.sent===1?"":"s"} sent; ${result.queued} newly queued.`:`Alerts queued, but email delivery needs configuration.`);router.refresh()}catch(error){setMessage(error instanceof Error?error.message:"Monitoring check failed")}finally{setBusy(false)}}}>{busy?<LoaderCircle className="spin" size={14}/>:<Send size={14}/>}Run monitoring check</button>{message&&<small className="form-result">{message}</small>}</div>}

type AdminSubscriptionSummary = {
  accessSource: string;
  status: string;
  currentPeriodEnd: string | null;
  complimentaryReason: string | null;
} | null;

export function ComplimentaryMembershipControl({ id, approved, subscription, plans }: { id: string; approved: boolean; subscription: AdminSubscriptionSummary; plans: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const activeComplimentary = subscription?.accessSource === "COMPLIMENTARY"
    && subscription.status === "ACTIVE"
    && (!subscription.currentPeriodEnd || new Date(subscription.currentPeriodEnd) > new Date());
  const paidMembershipInProgress = subscription?.accessSource === "STRIPE"
    && !["CANCELLED", "EXPIRED"].includes(subscription.status);

  async function submit(event: React.FormEvent<HTMLFormElement>, action: "GRANT" | "REVOKE") {
    event.preventDefault(); setBusy(true); setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      await call(`/api/admin/suppliers/${id}/membership`, "PATCH", action === "GRANT"
        ? { action, durationDays: data.get("durationDays"), reason: data.get("reason"), membershipPlanId: data.get("membershipPlanId") }
        : { action, reason: data.get("revokeReason") });
      setMessage(action === "GRANT" ? "Complimentary membership granted and audit logged." : "Complimentary membership revoked and audit logged.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Membership update failed"); }
    finally { setBusy(false); }
  }

  return <section className="panel form-section spaced-section">
    <div className="section-heading"><div><p className="eyebrow">Promotional access</p><h2>Complimentary membership</h2></div><Gift size={20}/></div>
    {activeComplimentary ? <>
      <div className="honesty-note">Active until {new Date(subscription.currentPeriodEnd!).toLocaleDateString("en-GB")}. Reason: {subscription.complimentaryReason}</div>
      <form className="form-stack" onSubmit={(event) => submit(event, "REVOKE")}>
        <label className="form-control"><span>Reason for revoking access</span><input name="revokeReason" minLength={3} maxLength={500} required /></label>
        <button className="button button-outline danger" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14}/> : <XCircle size={14}/>}Revoke free membership</button>
      </form>
    </> : paidMembershipInProgress ? <div className="honesty-note">This company has a live or unresolved Stripe membership. Complimentary access cannot replace paid billing.</div> : !approved ? <div className="honesty-note">Approve the supplier before granting promotional or testing access.</div> : <form className="form-stack" onSubmit={(event) => submit(event, "GRANT")}>
      <label className="form-control"><span>Membership tier</span><select name="membershipPlanId" required>{plans.map((plan)=><option value={plan.id} key={plan.id}>{plan.name}</option>)}</select></label>
      <label className="form-control"><span>Access duration</span><select name="durationDays" defaultValue="30"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="183">6 months</option><option value="366">12 months</option></select></label>
      <label className="form-control"><span>Promotional or testing reason</span><textarea name="reason" rows={3} minLength={3} maxLength={500} required placeholder="For example: launch partner testing" /></label>
      <button className="button button-dark" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14}/> : <Gift size={14}/>}Grant free membership</button>
    </form>}
    {message && <p className="form-result">{message}</p>}
  </section>;
}

type AdminSupplierRecord = {
  id: string;
  legalName: string;
  companyNumber: string | null;
  directorName: string | null;
  contactEmail: string;
  contactPhone: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
};

export function AdminSupplierEdit({ supplier }: { supplier: AdminSupplierRecord }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fields: Array<[string, keyof AdminSupplierRecord]> = [
    ["Legal company name", "legalName"],
    ["Companies House number", "companyNumber"],
    ["Director's full name", "directorName"],
    ["Company email", "contactEmail"],
    ["Company phone", "contactPhone"],
    ["Address line 1", "addressLine1"],
    ["Address line 2 (optional)", "addressLine2"],
    ["Town or city", "city"],
    ["County (optional)", "county"],
    ["Postcode", "postcode"],
  ];
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await call(`/api/admin/suppliers/${supplier.id}`, "PATCH", Object.fromEntries(fields.map(([, name]) => [name, data.get(name)])));
      setMessage("Supplier details saved and audit logged."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); }
    finally { setBusy(false); }
  }
  const required = new Set(["legalName", "companyNumber", "directorName", "contactEmail", "contactPhone", "addressLine1", "city", "postcode"]);
  return <form className="panel form-section" onSubmit={submit}><div className="section-heading"><div><p className="eyebrow">Administrator edit</p><h2>Company details</h2></div></div><div className="form-grid">{fields.map(([label, name]) => <label className="form-control" key={name}><span>{label}</span><input name={name} type={name === "contactEmail" ? "email" : "text"} defaultValue={supplier[name] ?? ""} required={required.has(name)} /></label>)}</div><div className="form-actions"><p className="form-result">{message}</p><button className="button button-dark" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>}Save supplier</button></div></form>;
}

type SupplierGeographyOverrides = {
  id: string;
  membershipTierOverride: "LOCAL" | "REGIONAL" | "NATIONWIDE" | null;
  maximumActiveOpportunitiesOverride: number | null;
  maximumServiceRadiusOverride: number | null;
  maximumDeliveryRadiusOverride: number | null;
  planName: string | null;
};

export function SupplierGeographyOverride({ supplier }: { supplier: SupplierGeographyOverrides }) {
  const router = useRouter(); const [busy,setBusy]=useState(false); const [message,setMessage]=useState("");
  const optionalNumber = (value: FormDataEntryValue | null) => String(value ?? "").trim() ? Number(value) : null;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); const data=new FormData(event.currentTarget);
    try {
      await call(`/api/admin/suppliers/${supplier.id}/geography`, "PATCH", {
        membershipTierOverride: String(data.get("membershipTierOverride") ?? "") || null,
        maximumActiveOpportunitiesOverride: optionalNumber(data.get("maximumActiveOpportunitiesOverride")),
        maximumServiceRadiusOverride: optionalNumber(data.get("maximumServiceRadiusOverride")),
        maximumDeliveryRadiusOverride: optionalNumber(data.get("maximumDeliveryRadiusOverride")),
      });
      setMessage("Geographic overrides saved and audit logged."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Override failed"); }
    finally { setBusy(false); }
  }
  return <form className="panel form-section spaced-section" onSubmit={submit}><div className="section-heading"><div><p className="eyebrow">Exceptional control</p><h2>Supplier geographic overrides</h2></div><ShieldAlert size={20}/></div><div className="honesty-note">Current paid or complimentary plan: {supplier.planName ?? "none"}. Leave fields blank to use the normal plan rules. Every override is audit logged.</div><div className="form-grid"><label className="form-control"><span>Tier override</span><select name="membershipTierOverride" defaultValue={supplier.membershipTierOverride ?? ""}><option value="">Use subscription plan</option><option value="LOCAL">Local</option><option value="REGIONAL">Regional</option><option value="NATIONWIDE">Nationwide</option></select></label><label className="form-control"><span>Maximum active opportunities</span><input name="maximumActiveOpportunitiesOverride" type="number" min="1" max="100" defaultValue={supplier.maximumActiveOpportunitiesOverride ?? ""} placeholder="Use plan limit"/></label><label className="form-control"><span>Service radius override</span><input name="maximumServiceRadiusOverride" type="number" min="1" max="500" defaultValue={supplier.maximumServiceRadiusOverride ?? ""} placeholder="Use plan radius"/></label><label className="form-control"><span>Delivery radius override</span><input name="maximumDeliveryRadiusOverride" type="number" min="1" max="500" defaultValue={supplier.maximumDeliveryRadiusOverride ?? ""} placeholder="Use plan radius"/></label></div><div className="form-actions"><p className="form-result">{message}</p><button className="button button-dark" disabled={busy}>{busy?<LoaderCircle className="spin" size={14}/>:<Check size={14}/>}Save geographic overrides</button></div></form>;
}

export function CoverageStatusButton({id,active}:{id:string;active:boolean}){const router=useRouter();const[busy,setBusy]=useState(false);return <button className="button button-outline" disabled={busy} onClick={async()=>{setBusy(true);try{await call(`/api/admin/coverage/${id}`,"PATCH",{active:!active});router.refresh()}finally{setBusy(false)}}}>{busy?<LoaderCircle className="spin" size={14}/>:null}{active?"Disable":"Enable"}</button>}
export function CategoryStatusButton({ id, active, isGroup, lockedReason }: { id: string; active: boolean; isGroup: boolean; lockedReason?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const label = lockedReason ? "Controls required" : isGroup ? (active ? "Take offline" : "Launch industry") : (active ? "Turn off" : "Turn on");
  return <div className="status-control">
    <button className="button button-outline" disabled={busy || Boolean(lockedReason)} title={lockedReason} onClick={async () => {
      setBusy(true); setMessage("");
      try { await call(`/api/admin/categories/${id}`, "PATCH", { active: !active }); router.refresh(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Category update failed"); }
      finally { setBusy(false); }
    }}>{busy ? <LoaderCircle className="spin" size={14}/> : lockedReason ? <ShieldAlert size={14}/> : null}{label}</button>
    {message && <small className="error-text">{message}</small>}
  </div>;
}
