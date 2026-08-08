import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("won job experience", () => {
  it("makes won work unmistakable in the request list and detail page", () => {
    const list = read("app/dashboard/requests/page.tsx");
    const detail = read("app/dashboard/requests/[reference]/page.tsx");
    expect(list).toContain('const displayStatus = isWon ? "YOU WON"');
    expect(list).toContain('className={`request-browser-row${isWon ? " is-won" : ""}`}');
    expect(detail).toContain("You won this job");
    expect(detail).toContain('quotation?.status === "ACCEPTED"');
  });

  it("surfaces the latest win prominently on the supplier dashboard", () => {
    const page = read("app/dashboard/page.tsx");
    const data = read("lib/data/supplier-dashboard.ts");
    const dashboard = read("components/dashboard/supplier-dashboard.tsx");
    expect(page).toContain("latestWonQuotation");
    expect(data).toContain('where: { supplierCompanyId, status: "ACCEPTED" }');
    expect(data).toContain('orderBy: { decidedAt: "desc" }');
    expect(dashboard).toContain('className="win-alert"');
    expect(dashboard).toContain("Open won job");
    expect(dashboard).toContain('demo ? "/demo#new-requests" : "/dashboard/requests?view=won"');
  });

  it("keeps the contact unlock inside a signed-in, audited database transaction", () => {
    const access = read("lib/contacts/access.ts");
    expect(access).toContain("runWithDatabaseIdentity(input.actorUserId");
    expect(access).toContain("prisma.$transaction");
    expect(access.indexOf("get_unlocked_customer_contact")).toBeLessThan(access.indexOf('action: "CONTACT_ACCESS.VIEWED"'));
  });
});
