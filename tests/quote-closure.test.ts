import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("customer quote selection closure", () => {
  it("withdraws every losing supplier assignment in the selection transaction", () => {
    const source = read("lib/quotes/selection.ts");
    expect(source).toContain("supplierAssignment.updateMany");
    expect(source).toContain('status: "WITHDRAWN"');
    expect(source).toContain('status: { in: ["DRAFT", "SUBMITTED", "SELECTED_PENDING_PAYMENT"] }');
  });

  it("locks and rechecks the request before a supplier quotation is saved", () => {
    const source = read("app/api/quotations/route.ts");
    expect(source).toContain('bridge_ai."QuoteRequest"');
    expect(source).toContain("FOR UPDATE");
    expect(source).toContain("This request has closed and can no longer receive quotations");
  });

  it("enforces the closed-request invariant inside Postgres", () => {
    const migration = read("supabase/migrations/20260807141210_launch_plumbing_heating_mechanical_vertical.sql");
    expect(migration).toContain("enforce_open_request_for_quotation_submission");
    expect(migration).toContain("supplier_quotation_open_request_guard");
    expect(migration).toContain("QUOTE_REQUEST_CLOSED");
  });
});
