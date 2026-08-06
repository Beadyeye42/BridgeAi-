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
});
