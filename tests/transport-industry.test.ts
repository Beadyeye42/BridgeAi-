import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isTransportCapabilityCategory,
  TRANSPORT_SERVICE_FEATURE_OPTIONS,
  TRANSPORT_VEHICLE_OPTIONS,
} from "../lib/capabilities/options";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("transport, delivery and removals launch", () => {
  it("creates one live industry with exact service categories and an audit record", () => {
    const migration = read("supabase/migrations/20260811190418_launch_transport_delivery_removals.sql");
    expect(migration).toContain("category_transport_delivery_removals");
    expect(migration).toContain("man-with-a-van");
    expect(migration).toContain("trade-collection-delivery");
    expect(migration).toContain("same-day-courier");
    expect(migration).toContain("multi-drop-delivery");
    expect(migration).toContain("SYSTEM.PRODUCT_CATALOGUE_LAUNCHED");
    expect(migration).toContain("Regulated waste disposal is not included");
    expect(migration).not.toContain("DELETE FROM");
  });

  it("uses transport-specific vehicle and service controls", () => {
    expect(isTransportCapabilityCategory("man-with-a-van")).toBe(true);
    expect(isTransportCapabilityCategory("upvc-windows")).toBe(false);
    expect(TRANSPORT_VEHICLE_OPTIONS).toContain("Luton van");
    expect(TRANSPORT_SERVICE_FEATURE_OPTIONS).toContain("Two-person crew");
    const manager = read("components/dashboard/capability-manager.tsx");
    expect(manager).toContain("Vehicles available");
    expect(manager).toContain("Crew and service features");
    expect(manager).toContain("Transport service available");
  });

  it("teaches WhatsApp the safe transport intake and excludes waste disposal", () => {
    const intake = read("lib/ai/quote-intake.ts");
    expect(intake).toContain("full collection and delivery postcodes");
    expect(intake).toContain("Transport intake must feel like a helpful conversation");
    expect(intake).toContain("Classify these requests as SERVICE");
    expect(intake).toContain("Do not route regulated waste disposal");
  });
});
