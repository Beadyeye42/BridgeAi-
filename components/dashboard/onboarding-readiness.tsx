import Link from "next/link";
import { CheckCircle2, Circle, ShieldCheck } from "lucide-react";
import type { SupplierOnboardingReadiness } from "@/lib/suppliers/onboarding";

export function OnboardingReadiness({
  readiness,
  status,
  admin = false,
}: {
  readiness: SupplierOnboardingReadiness;
  status: string;
  admin?: boolean;
}) {
  const approved = status === "APPROVED";
  return (
    <section className="panel onboarding-card" aria-label="Supplier onboarding readiness">
      <div className="onboarding-summary">
        <span className="large-icon"><ShieldCheck size={20} /></span>
        <div>
          <p className="eyebrow">{approved ? "Approved supplier" : "Approval checklist"}</p>
          <h2>{readiness.ready ? "Ready for approval" : `${readiness.completed} of ${readiness.total} requirements complete`}</h2>
          <p>{approved
            ? "Keep these records current to remain eligible for matched quote requests."
            : "Bridge AI cannot approve this supplier until every required item is complete."}</p>
        </div>
        <strong>{readiness.percentage}%</strong>
      </div>
      <div className="onboarding-progress" aria-hidden="true"><i style={{ width: `${readiness.percentage}%` }} /></div>
      <div className="onboarding-list">
        {readiness.items.map((item) => {
          const content = <>
            {item.complete ? <CheckCircle2 size={17} /> : <Circle size={17} />}
            <span><b>{item.label}</b><small>{item.description}</small></span>
          </>;
          return admin
            ? <div className={item.complete ? "complete" : "incomplete"} key={item.key}>{content}</div>
            : <Link className={item.complete ? "complete" : "incomplete"} href={item.href} key={item.key}>{content}</Link>;
        })}
      </div>
    </section>
  );
}
