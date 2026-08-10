import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("public legal documents", () => {
  it("publishes the verified controller identity and contact details", () => {
    const company = read("lib/legal/company.ts");
    expect(company).toContain('companyNumber: "16757150"');
    expect(company).toContain("60 Suffolk Road, Cheltenham, England, GL50 2AQ");
    expect(company).toContain("ironbridgegroup@outlook.com");
    expect(company).toContain('jurisdiction: "England and Wales"');
  });

  it("covers privacy, supplier, customer, cancellation and cookie obligations", () => {
    const privacy = read("app/legal/privacy/page.tsx");
    expect(privacy).toContain("AI and supplier matching");
    expect(privacy).toContain("International transfers");
    expect(privacy).toContain("How long we keep information");
    expect(privacy).toContain("Information Commissioner’s Office");

    expect(read("app/legal/terms/page.tsx")).toContain("After that point the Supplier cannot access or submit new quotations");
    expect(read("app/legal/customer-terms/page.tsx")).toContain("Customers do not create or use portal accounts");
    expect(read("app/legal/cancellation/page.tsx")).toContain("Manage billing or cancel");
    expect(read("app/legal/cookies/page.tsx")).toContain("bridge_affiliate_ref");
  });

  it("links the policies at registration, on the homepage and in billing", () => {
    const registration = read("components/auth/auth-form.tsx");
    expect(registration).toContain('href="/legal/terms"');
    expect(registration).toContain('href="/legal/privacy"');
    expect(registration).toContain('href="/legal/cancellation"');

    const home = read("app/page.tsx");
    expect(home).toContain('href="/legal/customer-terms"');
    expect(home).toContain('href="/legal/cookies"');

    const billing = read("app/dashboard/subscription/page.tsx");
    expect(billing).toContain("Cancellation is scheduled");
    expect(billing).toContain("Manage billing or cancel");
  });

  it("records acceptance against the current supplier terms version", () => {
    expect(read("app/api/auth/register/route.ts")).toContain('supplier-terms-2026-08-10-v2');
  });
});
