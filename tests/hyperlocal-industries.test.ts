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

  it("keeps recognition phrases unique so requests route to one service", () => {
    const aliases = HYPERLOCAL_INDUSTRIES.flatMap((industry) => industry.services.flatMap((service) => service.aliases.map((alias) => ({ alias, slug: service.slug }))));
    const duplicates = aliases.filter((entry, index) => aliases.findIndex((candidate) => candidate.alias.toLocaleLowerCase("en-GB") === entry.alias.toLocaleLowerCase("en-GB")) !== index);
    expect(duplicates).toEqual([]);
  });

  it("has a natural single-question prompt for every service qualification field", () => {
    for (const industry of HYPERLOCAL_INDUSTRIES) {
      for (const service of industry.services) {
        const draft = {
          categorySlug: service.slug,
          title: service.name,
          summary: `Customer needs ${service.name.toLocaleLowerCase("en-GB")}.`,
          items: [{ description: service.name }],
        };
        const decision = hyperlocalServiceIntakeDecision(draft, [{
          direction: "INBOUND",
          text: `I need ${service.name.toLocaleLowerCase("en-GB")}.`,
        }]);
        if (decision.shouldAsk) {
          expect(decision.prompt, service.slug).toBeTruthy();
          expect(decision.prompt?.match(/\?/g)?.length ?? 0, service.slug).toBeLessThanOrEqual(1);
          expect(decision.prompt, service.slug).not.toContain("should the specialist allow for");
        }
      }
    }
  });

  it.each([
    ["I am locked out of my house", "emergency-locksmith"],
    ["My boiler has stopped and there is no hot water", "boiler-repair"],
    ["I need a mobile tyre fitted today", "mobile-tyre-fitting"],
    ["My dishwasher is leaking", "dishwasher-repair"],
    ["Can someone clear my overgrown garden?", "garden-clearance"],
    ["I need an end of tenancy deep clean", "deep-end-tenancy-cleaning"],
    ["Please tow my broken-down van", "breakdown-recovery"],
    ["There is water coming through my ceiling", "emergency-plumbing"],
    ["Can someone clear our office?", "property-clearance"],
    ["I need garden clearance and the waste taken away", "garden-clearance"],
    ["Waste removal from my garden", "garden-clearance"],
    ["Garden rubbish removal", "garden-clearance"],
    ["Please remove rubbish from the garden", "garden-clearance"],
    ["I need rubbish clearance from my garage", "property-clearance"],
    ["My Bosch washing machine is showing an error", "washing-laundry-appliance-repair"],
    ["I need CCTV installed around my shop", "cctv-alarms-intercom"],
  ])("recognises a natural request without an industry menu: %s", (message, slug) => {
    expect(recogniseCatalogueProduct(message, categories)?.categorySlug).toBe(slug);
  });

  it("asks one natural service-specific question at a time and progresses", () => {
    const draft = { categorySlug: "boiler-repair", title: "Boiler stopped", summary: "No heating", items: [{ description: "Boiler repair" }] };
    const first = hyperlocalServiceIntakeDecision(draft, [{ direction: "INBOUND", text: "My boiler stopped today" }]);
    expect(first.shouldAsk).toBe(true);
    expect(first.nextField).toBe("boiler_make_model");
    expect(first.prompt).toBe("I can help with that. What is the boiler make and model? A photo of the front and display is fine.");
    expect(first.prompt).not.toContain("industry");
    const later = hyperlocalServiceIntakeDecision(draft, [
      { direction: "INBOUND", text: "My boiler stopped today" },
      { direction: "OUTBOUND", text: first.prompt! },
      { direction: "INBOUND", text: "Worcester Greenstar, error EA" },
    ]);
    expect(later.shouldAsk).toBe(true);
    expect(later.nextField).toBe("hot_water_status");
    expect(later.prompt).toBe("Thanks — Do you have any hot water at the moment?");
    expect(later.prompt).not.toBe(first.prompt);
  });

  it.each([
    ["mobile-tyre-fitting", "I have a flat tyre on car AB12 CDE", "tyre_size", "tyre size"],
    ["emergency-plumbing", "A pipe has burst in my house", "water_isolated", "water off"],
    ["domestic-cleaning", "I need a cleaner for my three bedroom house", "bathrooms", "bathrooms"],
    ["garden-clearance", "Please clear my large overgrown garden", "waste_volume", "how much"],
    ["garden-clearance", "Waste removal from my garden", "waste_volume", "how much"],
    ["dishwasher-repair", "My Bosch dishwasher shows E15 and is leaking", "model", "brand and model"],
    ["emergency-locksmith", "I am locked out of my front door", "authority_to_access", "authorised to access"],
  ])("collects the next price-critical detail for %s", (slug, message, expectedField, expectedWords) => {
    const decision = hyperlocalServiceIntakeDecision({
      categorySlug: slug,
      title: message,
      summary: message,
      items: [{ description: message }],
    }, [{ direction: "INBOUND", text: message }]);
    expect(decision.isHyperlocalService).toBe(true);
    expect(decision.nextField).toBe(expectedField);
    expect(decision.prompt?.toLocaleLowerCase("en-GB")).toContain(expectedWords);
    expect(decision.prompt?.match(/\?/g)).toHaveLength(1);
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
    const capabilityManager = read("components/dashboard/capability-manager.tsx");
    expect(capabilityManager).toContain("Appliance brands supported");
    expect(capabilityManager).toContain('"Bosch"');
    const routingMigration = read("supabase/migrations/20260812163000_clarify_hyperlocal_clearance_routing.sql");
    expect(routingMigration).toContain("SYSTEM.HYPERLOCAL_CLEARANCE_ROUTING_CLARIFIED");
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
