import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HYPERLOCAL_INDUSTRIES,
  hyperlocalRecognitionRules,
  hyperlocalService,
  inferUrgency,
  recurrenceCadence,
} from "../lib/categories/hyperlocal-industries";
import { evaluateCapability, missingVerificationRequirements } from "../lib/matching/suppliers";
import { hyperlocalServiceIntakeDecision } from "../lib/whatsapp/intake-state";
import { recogniseCatalogueProduct, type ProductKnowledgeCategory } from "../lib/whatsapp/product-knowledge";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const categories: ProductKnowledgeCategory[] = hyperlocalRecognitionRules().map((rule) => ({
  slug: rule.serviceSlug,
  name: rule.label,
  description: null,
  parent: { slug: rule.industrySlug },
}));

describe("Hyperlocal service network", () => {
  it("defines exactly six industries with unique services and progressive questions", () => {
    expect(HYPERLOCAL_INDUSTRIES).toHaveLength(6);
    const services = HYPERLOCAL_INDUSTRIES.flatMap((industry) => industry.services);
    expect(services.length).toBeGreaterThanOrEqual(45);
    expect(new Set(services.map((service) => service.slug)).size).toBe(services.length);
    for (const service of services) {
      expect(service.requiredInformation).toContain("postcode");
      expect(service.requiredInformation).toContain("urgency");
      expect(service.capabilities.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ["I am locked out of my house", "emergency-locksmith"],
    ["My boiler has stopped and there is no hot water", "boiler-repair"],
    ["I need a mobile tyre fitted today", "mobile-tyre-fitting"],
    ["My dishwasher is leaking", "dishwasher-repair"],
    ["Can someone clear my overgrown garden?", "garden-clearance"],
    ["I need an end of tenancy deep clean", "deep-end-tenancy-cleaning"],
  ])("recognises a natural request without an industry menu: %s", (message, slug) => {
    expect(recogniseCatalogueProduct(message, categories)?.categorySlug).toBe(slug);
  });

  it("asks one service-specific question and does not repeat it", () => {
    const draft = { categorySlug: "boiler-repair", title: "Boiler stopped", summary: "No heating", items: [{ description: "Boiler repair" }] };
    const first = hyperlocalServiceIntakeDecision(draft, [{ direction: "INBOUND", text: "My boiler stopped today" }]);
    expect(first.shouldAsk).toBe(true);
    expect(first.prompt).toContain("right local specialist");
    expect(first.prompt).not.toContain("industry");
    const later = hyperlocalServiceIntakeDecision(draft, [
      { direction: "INBOUND", text: "My boiler stopped today" },
      { direction: "OUTBOUND", text: first.prompt! },
      { direction: "INBOUND", text: "Worcester Greenstar, error EA" },
    ]);
    expect(later.shouldAsk).toBe(false);
  });

  it("classifies urgency and repeat work deterministically", () => {
    expect(inferUrgency("I am locked out right now", null)).toBe("EMERGENCY");
    expect(inferUrgency("Can you come tomorrow?", null)).toBe("NEXT_DAY");
    expect(recurrenceCadence("We need a regular cleaner weekly")).toBe("WEEKLY");
    expect(recurrenceCadence("Just a one-off deep clean")).toBe("ONE_OFF");
  });

  it("requires fresh immediate availability for emergency matching", () => {
    const now = new Date("2026-08-12T09:00:00Z");
    const base = {
      id: "cap_locksmith", manufacturerNames: [], systemNames: [], colourNames: [], finishNames: [], minimumOrderValue: null,
      minimumOrderQuantity: null, standardLeadTimeDays: 1, urgentLeadTimeDays: 1, currentLeadTimeDays: 1,
      collectionAvailable: false, supportsSupplyOnly: false, supportsDelivery: false, supportsInstallation: false, supportsService: true,
      servesConsumer: true, servesTrade: true, servesBusiness: true, deliveryDays: [1,2,3,4,5,6,7], capacityStatus: "AVAILABLE" as const,
      liveAvailability: "AVAILABLE_NOW" as const, nextAvailableAt: now, shortageNote: null, shortageUntil: null,
      lastConfirmedAt: now, capacityLastConfirmedAt: now, leadTimeLastConfirmedAt: now, availabilityLastConfirmedAt: now,
    };
    const request = {
      id: "request", categoryId: "emergency-locksmith", buyerType: "CONSUMER" as const, deliveryPostcode: "GL52 6TD",
      deliveryLatitude: 51.9, deliveryLongitude: -2.1, fulfilmentMode: "SERVICE" as const, urgency: "EMERGENCY" as const,
      requiredBy: new Date("2026-08-12T10:00:00Z"), items: [{ quantity: 1 }],
    };
    const coverage = { type: "DISTANCE" as const, label: "Company base", description: "Inside service radius", distanceMiles: 3 };
    expect(evaluateCapability(request, base, coverage, now).outcome).toBe("MATCHED");
    expect(evaluateCapability(request, { ...base, liveAvailability: "AVAILABLE_TOMORROW" as const }, coverage, now).outcome).toBe("REJECTED");
    expect(evaluateCapability(request, { ...base, availabilityLastConfirmedAt: new Date("2026-08-01T09:00:00Z") }, coverage, now).outcome).toBe("REJECTED");
  });

  it("preserves the controlled commercial and lifecycle rules", () => {
    expect(read("lib/matching/suppliers.ts")).toContain('Math.min(5, limit)');
    expect(read("lib/matching/suppliers.ts")).toContain("An active supplier subscription is required");
    expect(read("lib/billing/membership-plans.ts")).toContain('HYPERLOCAL: 10');
    expect(read("prisma/schema.prisma")).toContain("SELECTED");
    expect(read("prisma/schema.prisma")).toContain("CANCELLED_AFTER_SELECTION");
  });

  it("ships the full database catalogue and the new persisted intake state", () => {
    const migration = read("supabase/migrations/20260811235611_hyperlocal_industries_expansion.sql");
    expect(migration).toContain("SYSTEM.HYPERLOCAL_INDUSTRIES_EXPANDED");
    expect(migration).toContain("HYPERLOCAL_SERVICE");
    expect(migration).toContain("attachmentExtractionConfidence");
    expect(hyperlocalService("emergency-plumbing")?.service.verification).toContain("insurance");
  });

  it("blocks regulated work when the required approved evidence is missing", () => {
    const company = { status: "APPROVED" as const, companyNumber: "12345678", addressLine1: "1 Bridge Street", postcode: "GL52 6TD" };
    expect(missingVerificationRequirements({
      ...company,
      requirements: ["regulated_heating_credential", "insurance"],
      accreditations: [],
    })).toEqual(["regulated_heating_credential", "insurance"]);
    expect(missingVerificationRequirements({
      ...company,
      requirements: ["identity_business_check", "verified_business_address", "regulated_heating_credential", "insurance", "admin_approval"],
      accreditations: [
        { type: "CERTIFICATION", displayName: "Gas Safe Register", issuingBody: "Gas Safe", referenceNumber: "123456" },
        { type: "PUBLIC_LIABILITY_INSURANCE", displayName: "Public liability", issuingBody: "Insurer", referenceNumber: "PL-1" },
      ],
    })).toEqual([]);
  });
});
