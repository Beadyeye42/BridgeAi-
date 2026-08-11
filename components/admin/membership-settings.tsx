"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, Plus, Save } from "lucide-react";

type Plan = { id: string; code: string; name: string; tier: string; description: string | null; monthlyPricePence: number; maximumRadiusMiles: number | null; nationwideAllowed: boolean; maximumActiveOpportunities: number; taxEnabled: boolean; active: boolean; providerPriceId: string | null; displayOrder: number };
type MatchingWeights = { capability: number; leadTime: number; capacity: number; coverage: number; locality: number; response: number; completion: number; reliability: number };
type Matching = { maximumSuppliersPerRequest: number; capacityStaleDays: number; leadTimeStaleDays: number; responseDeadlineHours: number; acknowledgementDeadlineHours: number; quotationDeadlineHours: number; sparseMarketMaximumEligible: number; healthyMarketMaximumEligible: number; sparseFairnessWeight: number; healthyFairnessWeight: number; denseFairnessWeight: number; fairnessSimilarityBandPoints: number; sparseSoftCapEnabled: boolean; healthySoftCapExtraOpportunities: number; respectDeclaredMonthlyCapacity: boolean; declaredCapacityWarningPercent: number; coverageGapAlertsEnabled: boolean; automaticNextSupplierInvitation: boolean; serviceMatchingEnabled: boolean; deliveryMatchingEnabled: boolean; matchingWeights: unknown };
type Promotion = { id: string; name: string; eligiblePlanCodes: string[]; promotionalPricePence: number; durationMonths: number; subscriberLimit: number | null; startsAt: string; endsAt: string | null; existingSubscribersQualify: boolean; active: boolean; _count: { subscriptions: number } };

const defaultWeights: MatchingWeights = { capability: 35, leadTime: 20, capacity: 15, coverage: 12, locality: 8, response: 5, completion: 3, reliability: 2 };

async function save(url: string, body: unknown, method = "PATCH") {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "The settings could not be saved");
  return result;
}

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function promotionPayload(data: FormData, plans: Plan[]) {
  return {
    name: data.get("name"),
    eligiblePlanCodes: plans.filter((plan) => data.has(`plan-${plan.id}`)).map((plan) => plan.code),
    promotionalPricePence: Math.round(Number(data.get("promotionalPrice")) * 100),
    durationMonths: Number(data.get("durationMonths")),
    subscriberLimit: String(data.get("subscriberLimit") ?? "").trim() ? Number(data.get("subscriberLimit")) : null,
    startsAt: new Date(String(data.get("startsAt"))).toISOString(),
    endsAt: String(data.get("endsAt") ?? "").trim() ? new Date(String(data.get("endsAt"))).toISOString() : null,
    existingSubscribersQualify: data.has("existingSubscribersQualify"),
    active: data.has("active"),
  };
}

export function MembershipSettings({ plans, matching, promotions }: { plans: Plan[]; matching: Matching; promotions: Promotion[] }) {
  const router = useRouter(); const [busy, setBusy] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  async function savePlan(event: React.FormEvent<HTMLFormElement>, plan: Plan) {
    event.preventDefault(); setBusy(plan.id); setMessage(""); setError(""); const data = new FormData(event.currentTarget);
    try {
      const result = await save(`/api/admin/membership/plans/${plan.id}`, { name: data.get("name"), description: String(data.get("description") ?? "") || null, monthlyPricePence: Math.round(Number(data.get("monthlyPrice")) * 100), maximumRadiusMiles: plan.tier === "NATIONWIDE" ? null : Number(data.get("maximumRadiusMiles")), nationwideAllowed: plan.tier === "NATIONWIDE", maximumActiveOpportunities: Number(data.get("maximumActiveOpportunities")), taxEnabled: false, providerPriceId: String(data.get("providerPriceId") ?? "").trim() || null, displayOrder: Number(data.get("displayOrder")), active: data.has("active") });
      setMessage(result.stripePriceRefreshRequired ? "Plan saved. Stripe will create the replacement recurring price at the next checkout or plan change." : "Plan saved."); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed"); } finally { setBusy(""); }
  }
  async function saveMatching(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("matching"); setMessage(""); setError(""); const data = new FormData(event.currentTarget);
    try { await save("/api/admin/membership/matching", { maximumSuppliersPerRequest: Number(data.get("maximumSuppliersPerRequest")), capacityStaleDays: Number(data.get("capacityStaleDays")), leadTimeStaleDays: Number(data.get("leadTimeStaleDays")), responseDeadlineHours: Number(data.get("responseDeadlineHours")), acknowledgementDeadlineHours: Number(data.get("acknowledgementDeadlineHours")), quotationDeadlineHours: Number(data.get("quotationDeadlineHours")), sparseMarketMaximumEligible: Number(data.get("sparseMarketMaximumEligible")), healthyMarketMaximumEligible: Number(data.get("healthyMarketMaximumEligible")), sparseFairnessWeight: Number(data.get("sparseFairnessWeight")), healthyFairnessWeight: Number(data.get("healthyFairnessWeight")), denseFairnessWeight: Number(data.get("denseFairnessWeight")), fairnessSimilarityBandPoints: Number(data.get("fairnessSimilarityBandPoints")), sparseSoftCapEnabled: data.has("sparseSoftCapEnabled"), healthySoftCapExtraOpportunities: Number(data.get("healthySoftCapExtraOpportunities")), respectDeclaredMonthlyCapacity: data.has("respectDeclaredMonthlyCapacity"), declaredCapacityWarningPercent: Number(data.get("declaredCapacityWarningPercent")), coverageGapAlertsEnabled: data.has("coverageGapAlertsEnabled"), automaticNextSupplierInvitation: data.has("automaticNextSupplierInvitation"), serviceMatchingEnabled: data.has("serviceMatchingEnabled"), deliveryMatchingEnabled: data.has("deliveryMatchingEnabled"), matchingWeights: Object.fromEntries(Object.keys(defaultWeights).map((key)=>[key, Number(data.get(`weight-${key}`))])) }); setMessage("Adaptive matching controls saved."); router.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed"); } finally { setBusy(""); }
  }
  async function savePromotion(event: React.FormEvent<HTMLFormElement>, promotionId?: string) {
    event.preventDefault(); const key = promotionId ?? "promotion-new"; setBusy(key); setMessage(""); setError("");
    try {
      const result = await save(promotionId ? `/api/admin/membership/promotions/${promotionId}` : "/api/admin/membership/promotions", promotionPayload(new FormData(event.currentTarget), plans), promotionId ? "PATCH" : "POST");
      setMessage(`Promotion ${promotionId ? "saved" : "created"}. Stripe will apply it automatically to eligible new checkouts.`);
      if (!promotionId) event.currentTarget.reset();
      router.refresh();
      return result;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Promotion save failed"); } finally { setBusy(""); }
  }
  return <div className="management-form">
    {(message || error) && <p className={`form-result ${error ? "error" : "success"}`}>{!error && <CheckCircle2 size={14}/>} {error || message}</p>}
    <div className="pricing-grid">{plans.map((plan)=><form className="panel form-section" key={plan.id} onSubmit={(event)=>savePlan(event, plan)}><div className="section-heading"><div><p className="eyebrow">{plan.tier}</p><h2>{plan.name}</h2></div><span className={`status-pill ${plan.active ? "approved" : "suspended"}`}>{plan.active ? "LIVE" : "OFFLINE"}</span></div><label className="form-control"><span>Public plan name</span><input name="name" defaultValue={plan.name} required/></label><label className="form-control"><span>Description</span><textarea name="description" defaultValue={plan.description ?? ""}/></label><label className="form-control"><span>Monthly price (£)</span><input name="monthlyPrice" type="number" min="1" step="0.01" defaultValue={(plan.monthlyPricePence/100).toFixed(2)} required/></label>{plan.tier !== "NATIONWIDE" && <label className="form-control"><span>Maximum radius (miles)</span><input name="maximumRadiusMiles" type="number" min="1" max={plan.tier === "HYPERLOCAL" ? 10 : 500} defaultValue={plan.maximumRadiusMiles ?? ""} required/></label>}<label className="form-control"><span>Maximum live opportunities</span><input name="maximumActiveOpportunities" type="number" min="1" max="100" defaultValue={plan.maximumActiveOpportunities} required/></label><label className="form-control"><span>Display order</span><input name="displayOrder" type="number" min="0" max="1000" defaultValue={plan.displayOrder} required/></label><label className="form-control"><span>Stripe recurring Price ID</span><input name="providerPriceId" defaultValue={plan.providerPriceId ?? ""} placeholder="Created securely if left blank"/></label><label className="toggle-row"><span><b>Plan available</b><small>Show this plan for eligible new and existing suppliers.</small></span><input name="active" type="checkbox" defaultChecked={plan.active}/></label><small className="body-copy">Stripe price: {plan.providerPriceId ? "configured" : "created securely when first selected"}</small><button className="button button-dark" disabled={Boolean(busy)}>{busy===plan.id?<LoaderCircle className="spin" size={15}/>:<Save size={15}/>} Save plan</button></form>)}</div>
    <form className="panel form-section settings-width" onSubmit={saveMatching}>
      <div className="section-heading"><div><p className="eyebrow">Adaptive routing control</p><h2>Density, fairness and replacement rules</h2></div></div>
      <p className="body-copy">Bridge AI classifies every request after mandatory capability, subscription, capacity and location filters. Thin markets protect buyer fulfilment; dense markets use stronger exposure fairness among similarly qualified suppliers.</p>
      <div className="form-grid">
        <label className="form-control"><span>Maximum active suppliers per request</span><input name="maximumSuppliersPerRequest" type="number" min="1" max="5" defaultValue={matching.maximumSuppliersPerRequest}/></label>
        <label className="form-control"><span>Acknowledgement deadline (business hours)</span><input name="acknowledgementDeadlineHours" type="number" min="1" max="168" defaultValue={matching.acknowledgementDeadlineHours}/></label>
        <label className="form-control"><span>Quotation deadline (business hours)</span><input name="quotationDeadlineHours" type="number" min="1" max="336" defaultValue={matching.quotationDeadlineHours}/></label>
        <input name="responseDeadlineHours" type="hidden" value={matching.responseDeadlineHours}/>
        <label className="form-control"><span>Capacity stale after (days)</span><input name="capacityStaleDays" type="number" min="1" max="90" defaultValue={matching.capacityStaleDays}/></label>
        <label className="form-control"><span>Lead time stale after (days)</span><input name="leadTimeStaleDays" type="number" min="1" max="90" defaultValue={matching.leadTimeStaleDays}/></label>
        <label className="form-control"><span>Sparse market maximum</span><input name="sparseMarketMaximumEligible" type="number" min="1" max="4" defaultValue={matching.sparseMarketMaximumEligible}/></label>
        <label className="form-control"><span>Healthy market maximum</span><input name="healthyMarketMaximumEligible" type="number" min="5" max="100" defaultValue={matching.healthyMarketMaximumEligible}/></label>
        <label className="form-control"><span>Sparse fairness weight</span><input name="sparseFairnessWeight" type="number" min="0" max="2" defaultValue={matching.sparseFairnessWeight}/></label>
        <label className="form-control"><span>Healthy fairness weight</span><input name="healthyFairnessWeight" type="number" min="3" max="7" defaultValue={matching.healthyFairnessWeight}/></label>
        <label className="form-control"><span>Dense fairness weight</span><input name="denseFairnessWeight" type="number" min="5" max="12" defaultValue={matching.denseFairnessWeight}/></label>
        <label className="form-control"><span>Similar-score band (points)</span><input name="fairnessSimilarityBandPoints" type="number" min="1" max="20" defaultValue={matching.fairnessSimilarityBandPoints}/></label>
        <label className="form-control"><span>Healthy-market soft-cap allowance</span><input name="healthySoftCapExtraOpportunities" type="number" min="0" max="10" defaultValue={matching.healthySoftCapExtraOpportunities}/></label>
        <label className="form-control"><span>Capacity warning threshold (%)</span><input name="declaredCapacityWarningPercent" type="number" min="50" max="100" defaultValue={matching.declaredCapacityWarningPercent}/></label>
      </div>
      <div className="section-subheading">Core suitability weights</div><p className="body-copy">Fairness never replaces these factors and only applies inside the similar-score band.</p>
      <div className="form-grid">{Object.entries(defaultWeights).map(([key,fallback])=><label className="form-control" key={key}><span>{key.replace(/([A-Z])/g," $1").replace(/^./,(letter)=>letter.toUpperCase())}</span><input name={`weight-${key}`} type="number" min="0" max="100" step="1" defaultValue={typeof matching.matchingWeights === "object" && matching.matchingWeights !== null && !Array.isArray(matching.matchingWeights) ? Number((matching.matchingWeights as Record<string,unknown>)[key] ?? fallback) : fallback}/></label>)}</div>
      <div className="toggle-list">
        <label className="toggle-row"><span><b>Sparse-market soft cap</b><small>Allow otherwise eligible suppliers above their normal active-opportunity cap when buyer fulfilment is at risk.</small></span><input name="sparseSoftCapEnabled" type="checkbox" defaultChecked={matching.sparseSoftCapEnabled}/></label>
        <label className="toggle-row"><span><b>Use declared monthly capacity</b><small>Reduce ranking gently near declared capacity; never cap wins.</small></span><input name="respectDeclaredMonthlyCapacity" type="checkbox" defaultChecked={matching.respectDeclaredMonthlyCapacity}/></label>
        <label className="toggle-row"><span><b>Coverage-gap alerts</b><small>Alert administrators when a confirmed request has no eligible supplier.</small></span><input name="coverageGapAlertsEnabled" type="checkbox" defaultChecked={matching.coverageGapAlertsEnabled}/></label>
        <label className="toggle-row"><span><b>Invite next ranked supplier</b><small>Replace a decline or expired acknowledgement automatically while the request remains open.</small></span><input name="automaticNextSupplierInvitation" type="checkbox" defaultChecked={matching.automaticNextSupplierInvitation}/></label>
        <label className="toggle-row"><span><b>Service matching</b><small>Use installation/service coverage separately.</small></span><input name="serviceMatchingEnabled" type="checkbox" defaultChecked={matching.serviceMatchingEnabled}/></label>
        <label className="toggle-row"><span><b>Delivery matching</b><small>Use product delivery coverage separately.</small></span><input name="deliveryMatchingEnabled" type="checkbox" defaultChecked={matching.deliveryMatchingEnabled}/></label>
      </div>
      <button className="button button-dark" disabled={Boolean(busy)}>{busy==="matching"?<LoaderCircle className="spin" size={15}/>:<Save size={15}/>} Save adaptive matching controls</button>
    </form>
    <section className="panel form-section settings-width"><div className="section-heading"><div><p className="eyebrow">Promotions</p><h2>Introductory offers</h2><p className="body-copy">Promotions are separate from the geographic plans. Set the eligible tier, temporary monthly price, duration and optional supplier limit.</p></div></div>
      {promotions.map((promotion)=><form className="form-section" key={promotion.id} onSubmit={(event)=>savePromotion(event, promotion.id)}><div className="section-subheading">{promotion.name} · {promotion._count.subscriptions} claimed</div><div className="form-grid"><label className="form-control"><span>Promotion name</span><input name="name" defaultValue={promotion.name} required/></label><label className="form-control"><span>Promotional monthly price (£)</span><input name="promotionalPrice" type="number" min="1" step="0.01" defaultValue={(promotion.promotionalPricePence/100).toFixed(2)} required/></label><label className="form-control"><span>Duration (months)</span><input name="durationMonths" type="number" min="1" max="36" defaultValue={promotion.durationMonths} required/></label><label className="form-control"><span>Maximum suppliers (optional)</span><input name="subscriberLimit" type="number" min="1" defaultValue={promotion.subscriberLimit ?? ""}/></label><label className="form-control"><span>Starts</span><input name="startsAt" type="datetime-local" defaultValue={localDateTime(promotion.startsAt)} required/></label><label className="form-control"><span>Ends (optional)</span><input name="endsAt" type="datetime-local" defaultValue={localDateTime(promotion.endsAt)}/></label></div><div className="toggle-list">{plans.map((plan)=><label className="toggle-row" key={plan.id}><span><b>{plan.name}</b><small>{(plan.monthlyPricePence/100).toFixed(2)} standard monthly price</small></span><input name={`plan-${plan.id}`} value={plan.code} type="checkbox" defaultChecked={promotion.eligiblePlanCodes.includes(plan.code)}/></label>)}<label className="toggle-row"><span><b>Include existing subscribers</b><small>Otherwise only new memberships receive this offer.</small></span><input name="existingSubscribersQualify" type="checkbox" defaultChecked={promotion.existingSubscribersQualify}/></label><label className="toggle-row"><span><b>Promotion active</b><small>Only active offers within their date window can be applied.</small></span><input name="active" type="checkbox" defaultChecked={promotion.active}/></label></div><button className="button button-dark" disabled={Boolean(busy)}>{busy===promotion.id?<LoaderCircle className="spin" size={15}/>:<Save size={15}/>} Save promotion</button></form>)}
      <form className="form-section" onSubmit={(event)=>savePromotion(event)}><div className="section-subheading">Create a promotion</div><div className="form-grid"><label className="form-control"><span>Promotion name</span><input name="name" placeholder="Launch offer" required/></label><label className="form-control"><span>Promotional monthly price (£)</span><input name="promotionalPrice" type="number" min="1" step="0.01" required/></label><label className="form-control"><span>Duration (months)</span><input name="durationMonths" type="number" min="1" max="36" defaultValue="6" required/></label><label className="form-control"><span>Maximum suppliers (optional)</span><input name="subscriberLimit" type="number" min="1"/></label><label className="form-control"><span>Starts</span><input name="startsAt" type="datetime-local" defaultValue={localDateTime(new Date().toISOString())} required/></label><label className="form-control"><span>Ends (optional)</span><input name="endsAt" type="datetime-local"/></label></div><div className="toggle-list">{plans.map((plan)=><label className="toggle-row" key={plan.id}><span><b>{plan.name}</b><small>Make this tier eligible.</small></span><input name={`plan-${plan.id}`} value={plan.code} type="checkbox"/></label>)}<label className="toggle-row"><span><b>Include existing subscribers</b></span><input name="existingSubscribersQualify" type="checkbox"/></label><label className="toggle-row"><span><b>Activate immediately</b></span><input name="active" type="checkbox"/></label></div><button className="button button-dark" disabled={Boolean(busy)}>{busy==="promotion-new"?<LoaderCircle className="spin" size={15}/>:<Plus size={15}/>} Create promotion</button></form>
    </section>
  </div>;
}
