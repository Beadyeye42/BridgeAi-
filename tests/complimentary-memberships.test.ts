import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adminComplimentaryMembershipSchema } from "@/lib/auth/validation";
import { COMPLIMENTARY_PLAN_CODE, isComplimentaryMembership, isMembershipActive } from "@/lib/billing/pricing";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("administrator complimentary memberships", () => {
  it("accepts bounded grants and requires reasons for grants and revocations", () => {
    const grant = adminComplimentaryMembershipSchema.parse({ action: "GRANT", durationDays: "30", reason: "Launch partner testing", membershipPlanId: "plan_local_partner" });
    expect(grant.action).toBe("GRANT");
    if (grant.action !== "GRANT") throw new Error("Expected a grant");
    expect(grant.durationDays).toBe(30);
    expect(adminComplimentaryMembershipSchema.safeParse({ action: "GRANT", durationDays: 367, reason: "Testing" }).success).toBe(false);
    expect(adminComplimentaryMembershipSchema.safeParse({ action: "REVOKE", reason: "" }).success).toBe(false);
  });

  it("recognises active complimentary access and its expiry", () => {
    const now = new Date("2026-08-06T12:00:00Z");
    expect(COMPLIMENTARY_PLAN_CODE).toBe("bridge-ai-complimentary");
    expect(isComplimentaryMembership({ accessSource: "COMPLIMENTARY" })).toBe(true);
    expect(isMembershipActive({ status: "ACTIVE", currentPeriodEnd: new Date("2026-08-07T12:00:00Z") }, now)).toBe(true);
    expect(isMembershipActive({ status: "ACTIVE", currentPeriodEnd: new Date("2026-08-05T12:00:00Z") }, now)).toBe(false);
  });

  it("keeps the administrator write protected, audited and separate from Stripe", () => {
    const route = read("app/api/admin/suppliers/[id]/membership/route.ts");
    expect(route.indexOf("await requireAdminApi()")).toBeLessThan(route.indexOf("prisma.supplierCompany.findUnique"));
    expect(route).toContain("paidMembershipInProgress");
    expect(route).toContain("prisma.$transaction");
    expect(route).toContain("writeAuditLog");
    expect(route).toContain("ADMIN.COMPLIMENTARY_MEMBERSHIP_GRANTED");
    expect(route).toContain("ADMIN.COMPLIMENTARY_MEMBERSHIP_REVOKED");
    expect(route).not.toContain("trustedPrisma");
    expect(route).not.toContain("getStripe");
  });

  it("enforces trustworthy complimentary metadata in PostgreSQL", () => {
    const migration = read("supabase/migrations/20260806125242_admin_complimentary_supplier_memberships.sql");
    expect(migration).toContain('SubscriptionAccessSource');
    expect(migration).toContain("subscription_complimentary_metadata_valid");
    expect(migration).toContain("subscription_complimentary_revocation_valid");
    expect(migration).toContain('FOREIGN KEY ("complimentaryGrantedById")');
    expect(read("tests/sql/security_integration.sql")).toContain("Supplier granted its own complimentary membership");
  });

  it("shows complimentary access honestly to administrators and suppliers", () => {
    expect(read("components/admin/admin-actions.tsx")).toContain("Grant free membership");
    const supplierPage = read("app/dashboard/subscription/page.tsx");
    expect(supplierPage).toContain("Complimentary membership");
    expect(supplierPage).toContain("No card details are required and no payment will be taken");
  });
});
