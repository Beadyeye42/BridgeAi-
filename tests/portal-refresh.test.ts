import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("portal refresh control", () => {
  it("refreshes server-rendered portal data through the Next router", () => {
    const button = read("components/dashboard/refresh-button.tsx");
    expect(button).toContain("router.refresh()");
    expect(button).toContain('aria-label={refreshing ? "Refreshing page" : "Refresh page"}');
    expect(button).toContain('type="button"');
  });

  it("is available on supplier, administrator and mobile portal headers", () => {
    const portalPage = read("components/dashboard/portal-page.tsx");
    const dashboard = read("components/dashboard/supplier-dashboard.tsx");
    expect(portalPage.match(/<RefreshButton/g)).toHaveLength(2);
    expect(dashboard.match(/<RefreshButton/g)).toHaveLength(2);
  });

  it("does not present non-functional search, overflow or sample-download buttons", () => {
    const dashboard = read("components/dashboard/supplier-dashboard.tsx");
    const request = read("components/requests/request-detail.tsx");
    expect(dashboard).not.toContain('aria-label="Search"');
    expect(dashboard).not.toContain("More options for");
    expect(request).not.toContain('<button className="attachment-file"');
    expect(request).toContain("sample only");
  });

  it("keeps public demonstration navigation out of protected supplier routes", () => {
    const sidebar = read("components/dashboard/sidebar.tsx");
    const dashboard = read("components/dashboard/supplier-dashboard.tsx");
    expect(sidebar).toContain('demo = false');
    expect(sidebar).toContain('href: "/demo"');
    expect(sidebar).toContain('href: "/requests/BA-2026-0842"');
    expect(dashboard).toContain('const requestListHref = demo ? "/demo#new-requests" : "/dashboard/requests"');
  });

  it("prevents empty administrator assignments before calling the API", () => {
    const actions = read("components/admin/admin-actions.tsx");
    expect(actions).toContain("selectedIds.length === 0");
    expect(actions).toContain("Choose at least one supplier before assigning this request.");
    expect(actions).toContain("selectedIds.length === 0}");
  });

  it("handles empty or non-JSON server failures in important client actions", () => {
    for (const file of [
      "components/auth/auth-form.tsx",
      "components/billing/checkout-button.tsx",
      "components/requests/claim-opportunity.tsx",
    ]) {
      expect(read(file)).toContain("response.json().catch");
    }
  });
});
