import Link from "next/link";
import { CheckCircle2, Circle, ShieldCheck } from "lucide-react";
import type { SupplierOnboardingReadiness } from "@/lib/suppliers/onboarding";

export function OnboardingReadiness({
  readiness,
  status,
  admin = false,
  purpose = "approval",
}: {
  readiness: SupplierOnboardingReadiness;
  status: string;
  admin?: boolean;
  purpose?: "approval" | "matching";
}) {
  const approved = status === "APPROVED";
  const matching = purpose === "matching";
  return (
    <section className="panel onboarding-card" aria-label="Supplier onboarding readiness">
      <div className="onboarding-summary">
        <span className="large-icon"><ShieldCheck size={20} /></span>
        <div>
          <p className="eyebrow">{matching ? "Quote matching checklist" : approved ? "Approved supplier" : "Approval checklist"}</p>
          <h2>{readiness.ready ? (matching ? "Ready to receive matching quotes" : "Ready for approval") : `${readiness.completed} of ${readiness.total} requirements complete`}</h2>
          <p>{matching
            ? "Complete these details so Bridge AI can send only relevant opportunities to this supplier."
            : approved
              ? "Keep these company records current. Product and coverage choices are managed separately for quote matching."
              : "Bridge AI cannot approve this supplier until the company identity, address and contact details are complete."}</p>
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
