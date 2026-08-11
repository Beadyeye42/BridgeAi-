import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("selected job lifecycle", () => {
  it("separates customer selection from a confirmed and completed job", () => {
    const list = read("app/dashboard/requests/page.tsx");
    const detail = read("app/dashboard/requests/[reference]/page.tsx");
    expect(list).toContain('"selected", "confirmed", "completed"');
    expect(list).toContain("lifecycleDisplay");
    expect(detail).toContain("You’ve been selected");
    expect(detail).toContain("Good news—the customer has selected your quote to move forward.");
    expect(detail).toContain("JobLifecycleControl");
    expect(detail).toContain('quotation?.status === "ACCEPTED"');
  });

  it("surfaces the latest selection without calling it a win", () => {
    const page = read("app/dashboard/page.tsx");
    const data = read("lib/data/supplier-dashboard.ts");
    const dashboard = read("components/dashboard/supplier-dashboard.tsx");
    expect(page).toContain("latestSelectedQuotation");
    expect(data).toContain('where: { supplierCompanyId, status: "ACCEPTED" }');
    expect(data).toContain('orderBy: { decidedAt: "desc" }');
    expect(dashboard).toContain('className="win-alert"');
    expect(dashboard).toContain("View customer & continue");
    expect(dashboard).toContain('demo ? "/demo#new-requests" : "/dashboard/requests?view=selected"');
  });

  it("keeps the contact unlock inside a signed-in, audited database transaction", () => {
    const access = read("lib/contacts/access.ts");
    expect(access).toContain("runWithDatabaseIdentity(input.actorUserId");
    expect(access).toContain("prisma.$transaction");
    expect(access.indexOf("get_unlocked_customer_contact")).toBeLessThan(access.indexOf('action: "CONTACT_ACCESS.VIEWED"'));
  });
});
