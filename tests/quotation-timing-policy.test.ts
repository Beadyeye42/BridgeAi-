import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_QUOTATION_VALIDITY_DAYS, minimumQuotationValidUntil, quotationValidUntil } from "../lib/quotes/validity";

describe("quotation timing policy", () => {
  it("defaults every submitted quotation to seven days", () => {
    const submittedAt = new Date("2026-08-10T12:00:00.000Z");
    expect(DEFAULT_QUOTATION_VALIDITY_DAYS).toBe(7);
    expect(minimumQuotationValidUntil(submittedAt).toISOString()).toBe("2026-08-17T12:00:00.000Z");
    expect(quotationValidUntil(submittedAt, undefined).toISOString()).toBe("2026-08-17T12:00:00.000Z");
  });

  it("extends a short requested validity but preserves a longer one", () => {
    const submittedAt = new Date("2026-08-10T12:00:00.000Z");
    expect(quotationValidUntil(submittedAt, new Date("2026-08-12T23:59:59.999Z")).toISOString()).toBe("2026-08-17T12:00:00.000Z");
    expect(quotationValidUntil(submittedAt, new Date("2026-08-31T23:59:59.999Z")).toISOString()).toBe("2026-08-31T23:59:59.999Z");
  });

  it("uses the legacy 48-hour fallback, configurable response windows and seven-day validity", () => {
    const config = readFileSync("lib/config.ts", "utf8");
    const processor = readFileSync("lib/whatsapp/processor.ts", "utf8");
    const migration = readFileSync("supabase/migrations/20260810213238_enforce_two_day_response_and_seven_day_quote_validity.sql", "utf8");
    expect(config).toContain('boundedInteger("QUOTE_RESPONSE_HOURS", 48, 1, 336)');
    expect(processor).toContain("matchingConfiguration?.quotationDeadlineHours");
    expect(processor).toContain("?? matchingConfiguration?.responseDeadlineHours");
    expect(processor).toContain("category.parent?.acknowledgementDeadlineHours");
    expect(processor).toContain("?? matchingConfiguration?.acknowledgementDeadlineHours");
    expect(migration).toContain('SET "responseDeadlineHours" = 48');
    expect(migration).toContain("effective_submitted_at + interval '7 days'");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF status, \"submittedAt\", \"validUntil\"");
    expect(migration).toContain("SYSTEM.QUOTE_TIMING_POLICY_UPDATED");
  });
});
