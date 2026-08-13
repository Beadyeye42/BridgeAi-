import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractUkPostcodes,
  isTransportCategorySlug,
  matchingCoveragePurpose,
  resolveTransportCollectionPostcode,
} from "@/lib/categories/transport";

describe("transport geographic matching", () => {
  it("recognises man-with-a-van as transport", () => {
    expect(isTransportCategorySlug("man-with-a-van")).toBe(true);
    expect(isTransportCategorySlug("garden-maintenance")).toBe(false);
  });

  it("keeps collection and delivery postcodes separate", () => {
    const evidence = "Collect a washing machine from GL52 6TD and deliver it to GL1 5DT.";
    expect(extractUkPostcodes(evidence)).toEqual(["GL52 6TD", "GL1 5DT"]);
    expect(resolveTransportCollectionPostcode({
      deliveryPostcode: "GL1 5DT",
      evidence,
    })).toBe("GL52 6TD");
  });

  it("prefers an explicitly saved collection postcode", () => {
    expect(resolveTransportCollectionPostcode({
      collectionPostcode: "gl52 6td",
      deliveryPostcode: "NE30 2HH",
      evidence: "Delivery to NE30 2HH",
    })).toBe("GL52 6TD");
  });

  it("uses delivery coverage from the collection point for transport", () => {
    expect(matchingCoveragePurpose({
      categorySlug: "man-with-a-van",
      fulfilmentMode: "SERVICE",
    })).toBe("DELIVERY");
    expect(matchingCoveragePurpose({
      categorySlug: "garden-maintenance",
      fulfilmentMode: "SERVICE",
    })).toBe("SERVICE");
  });

  it("activates transport for consumer buyers with a one-day lead time", () => {
    const route = readFileSync(resolve(process.cwd(), "app/api/supplier/capabilities/route.ts"), "utf8");
    expect(route).toContain("servesConsumerByDefault");
    expect(route).toContain("currentLeadTimeDays: 1");
    expect(route).toContain("urgentLeadTimeDays: 1");
  });
});
