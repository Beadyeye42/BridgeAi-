import { Prisma } from "@prisma/client";
import { lookupPostcode, normalizePostcode, PostcodeLookupError } from "../location/postcodes";
import { bestCoverageMatch, distanceMiles as calculateDistanceMiles, type CoverageMatch, type DeliveryLocation } from "./coverage";
import { supplierOnboardingReadiness } from "../suppliers/onboarding";
import {
  isRalCode,
  isRalColourMarker,
  isStandardColour,
  normaliseCapabilityValue,
} from "../capabilities/options";
import { effectiveMembershipLimits } from "../billing/membership-plans";

type MatchingClient = Pick<Prisma.TransactionClient, "supplierCompany"> & Partial<Pick<Prisma.TransactionClient, "matchingConfiguration">>;

type RequestForMatching = {
  id: string;
  categoryId: string;
  deliveryPostcode: string;
  deliveryLatitude: Prisma.Decimal | number | null;
  deliveryLongitude: Prisma.Decimal | number | null;
  customerBudget?: Prisma.Decimal | number | null;
  requiredManufacturer?: string | null;
  requiredSystem?: string | null;
  requiredColour?: string | null;
  requiredFinish?: string | null;
  requiredBy?: Date | null;
  collectionRequired?: boolean;
  fulfilmentMode?: "SERVICE" | "INSTALLATION" | "SUPPLY_ONLY" | "DELIVERY" | "COLLECTION";
  items?: Array<{ quantity: Prisma.Decimal | number }>;
};

export type SupplierMatch = {
  id: string;
  name: string;
  postcode: string | null;
  match: CoverageMatch;
  score: number;
  reasons: string[];
  capabilitySnapshot: Prisma.InputJsonValue;
  membershipTier?: "LOCAL" | "REGIONAL" | "NATIONWIDE" | null;
  coveragePurpose?: "SERVICE" | "DELIVERY" | null;
  distanceMiles?: number | null;
  rankingSnapshot?: Prisma.InputJsonValue;
};

export type SupplierEvaluation = SupplierMatch & {
  outcome: "MATCHED" | "REJECTED";
};

export type LocationResolution = { location: DeliveryLocation; warning: string | null };

const DEFAULT_CAPACITY_STALE_DAYS = 7;
const DEFAULT_LEAD_TIME_STALE_DAYS = 14;
const DAY_MS = 86_400_000;

type MatchingWeights = {
  capability: number;
  leadTime: number;
  capacity: number;
  coverage: number;
  locality: number;
  response: number;
  completion: number;
  reliability: number;
};

const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
  capability: 35,
  leadTime: 20,
  capacity: 15,
  coverage: 12,
  locality: 8,
  response: 5,
  completion: 3,
  reliability: 2,
};

function matchingWeights(value: Prisma.JsonValue | null | undefined): MatchingWeights {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_MATCHING_WEIGHTS;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(DEFAULT_MATCHING_WEIGHTS).map(([key, fallback]) => {
    const configured = Number(record[key]);
    return [key, Number.isFinite(configured) && configured >= 0 ? configured : fallback];
  })) as MatchingWeights;
}

const supports = (values: string[], required: string) => {
  const wanted = normaliseCapabilityValue(required);
  return values.some((value) => {
    const supplied = normaliseCapabilityValue(value);
    return supplied === "any" || supplied === "all" || supplied === wanted;
  });
};

const supportsSystem = (values: string[], required: string) => {
  const wanted = normaliseCapabilityValue(required);
  return values.some((value) => {
    const supplied = normaliseCapabilityValue(value);
    return supplied === "any" || supplied === "all" || supplied === wanted || wanted.startsWith(`${supplied} `);
  });
};

const supportsColour = (values: string[], required: string) => {
  if (supports(values, required)) return true;
  if (isRalCode(required)) return values.some(isRalColourMarker);
  if (isStandardColour(required)) {
    return values.some((value) => normaliseCapabilityValue(value) === "all standard");
  }
  return false;
};

export async function resolveDeliveryLocation(request: Pick<RequestForMatching, "deliveryPostcode" | "deliveryLatitude" | "deliveryLongitude">): Promise<LocationResolution> {
  const latitude = request.deliveryLatitude === null ? null : Number(request.deliveryLatitude);
  const longitude = request.deliveryLongitude === null ? null : Number(request.deliveryLongitude);
  if (latitude !== null && longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { location: { postcode: normalizePostcode(request.deliveryPostcode), latitude, longitude }, warning: null };
  }
  try {
    const result = await lookupPostcode(request.deliveryPostcode);
    return { location: { postcode: normalizePostcode(result.postcode), latitude: result.latitude, longitude: result.longitude }, warning: null };
  } catch (error) {
    const warning = error instanceof PostcodeLookupError
      ? `${error.message} Distance-radius suppliers cannot be matched until the delivery postcode is resolved.`
      : "Distance matching is temporarily unavailable.";
    return { location: { postcode: normalizePostcode(request.deliveryPostcode), latitude: null, longitude: null }, warning };
  }
}

type Capability = {
  id: string;
  manufacturerNames: string[];
  systemNames: string[];
  colourNames: string[];
  finishNames: string[];
  minimumOrderValue: Prisma.Decimal | null;
  minimumOrderQuantity: number | null;
  standardLeadTimeDays: number;
  urgentLeadTimeDays: number | null;
  collectionAvailable: boolean;
  supportsSupplyOnly?: boolean;
  supportsDelivery?: boolean;
  supportsInstallation?: boolean;
  supportsService?: boolean;
  deliveryDays: number[];
  capacityStatus: "AVAILABLE" | "LIMITED" | "URGENT_ONLY" | "FULL" | "PAUSED" | "HOLIDAY" | "NOT_ACCEPTING";
  capacityLastConfirmedAt?: Date;
  leadTimeLastConfirmedAt?: Date;
  currentLeadTimeDays?: number | null;
  shortageNote: string | null;
  shortageUntil: Date | null;
  lastConfirmedAt: Date;
};

export function evaluateCapability(
  request: RequestForMatching,
  capability: Capability,
  coverage: CoverageMatch,
  now = new Date(),
  freshness: { capacityStaleDays?: number; leadTimeStaleDays?: number } = {},
) {
  const capacityStaleDays = freshness.capacityStaleDays ?? DEFAULT_CAPACITY_STALE_DAYS;
  const leadTimeStaleDays = freshness.leadTimeStaleDays ?? DEFAULT_LEAD_TIME_STALE_DAYS;
  const reasons: string[] = [coverage.description];
  const rejected: string[] = [];
  let score = 25;
  if (["FULL", "PAUSED", "HOLIDAY", "NOT_ACCEPTING"].includes(capability.capacityStatus)) rejected.push(`Current capacity is ${capability.capacityStatus.toLowerCase().replaceAll("_", " ")}`);
  const fulfilmentMode = request.fulfilmentMode ?? (request.collectionRequired ? "COLLECTION" : "DELIVERY");
  if (fulfilmentMode === "COLLECTION" && !capability.collectionAvailable) rejected.push("Collection is required but unavailable");
  if (fulfilmentMode === "SUPPLY_ONLY" && capability.supportsSupplyOnly === false) rejected.push("Supplier does not offer supply-only orders");
  if (fulfilmentMode === "DELIVERY" && capability.supportsDelivery === false) rejected.push("Supplier does not deliver this product");
  if (fulfilmentMode === "INSTALLATION" && capability.supportsInstallation !== true) rejected.push("Supplier does not offer installation for this product");
  if (fulfilmentMode === "SERVICE" && capability.supportsService !== true) rejected.push("Supplier does not offer this service");
  if (capability.shortageUntil && capability.shortageUntil > now) rejected.push(`Temporary shortage recorded until ${capability.shortageUntil.toLocaleDateString("en-GB")}`);
  if (request.requiredManufacturer) {
    if (supports(capability.manufacturerNames, request.requiredManufacturer)) { score += 12; reasons.push(`Manufactures ${request.requiredManufacturer}`); }
    else rejected.push(`Does not confirm manufacturer ${request.requiredManufacturer}`);
  }
  if (request.requiredSystem) {
    if (supportsSystem(capability.systemNames, request.requiredSystem)) { score += 12; reasons.push(`Offers system ${request.requiredSystem}`); }
    else rejected.push(`Does not confirm system ${request.requiredSystem}`);
  }
  if (request.requiredColour) {
    if (supportsColour(capability.colourNames, request.requiredColour)) { score += 10; reasons.push(`Offers colour ${request.requiredColour}`); }
    else rejected.push(`Does not confirm colour ${request.requiredColour}`);
  }
  if (request.requiredFinish) {
    if (supports(capability.finishNames, request.requiredFinish)) { score += 8; reasons.push(`Offers finish ${request.requiredFinish}`); }
    else rejected.push(`Does not confirm finish ${request.requiredFinish}`);
  }
  if (request.collectionRequired && fulfilmentMode !== "COLLECTION") {
    if (capability.collectionAvailable) { score += 5; reasons.push("Collection is available"); }
    else rejected.push("Collection is required but unavailable");
  }
  const requestedQuantity = (request.items ?? []).reduce((total, item) => total + Number(item.quantity), 0);
  if (capability.minimumOrderQuantity && requestedQuantity > 0 && requestedQuantity < capability.minimumOrderQuantity) {
    rejected.push(`Order quantity is below the supplier minimum of ${capability.minimumOrderQuantity}`);
  }
  if (capability.minimumOrderValue && request.customerBudget !== null && request.customerBudget !== undefined && Number(request.customerBudget) < Number(capability.minimumOrderValue)) {
    rejected.push(`Customer budget is below the supplier minimum order value`);
  }
  const capacityConfirmedAt = capability.capacityLastConfirmedAt ?? capability.lastConfirmedAt;
  const leadTimeConfirmedAt = capability.leadTimeLastConfirmedAt ?? capability.lastConfirmedAt;
  const ageDays = Math.max(0, Math.floor((now.getTime() - capacityConfirmedAt.getTime()) / DAY_MS));
  const leadTimeAgeDays = Math.max(0, Math.floor((now.getTime() - leadTimeConfirmedAt.getTime()) / DAY_MS));
  if (ageDays <= capacityStaleDays) { score += 10; reasons.push(`Availability confirmed ${ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"} ago`}`); }
  else { score = Math.max(0, score - Math.min(20, ageDays - capacityStaleDays)); reasons.push(`Availability is ${ageDays} days old, so confidence is reduced`); }

  if (request.requiredBy) {
    const allowedDays = Math.max(0, Math.ceil((request.requiredBy.getTime() - now.getTime()) / DAY_MS));
    const leadTime = capability.urgentLeadTimeDays && capability.urgentLeadTimeDays <= allowedDays
      ? capability.urgentLeadTimeDays
      : capability.currentLeadTimeDays ?? capability.standardLeadTimeDays;
    if (leadTimeAgeDays > leadTimeStaleDays) rejected.push("Lead-time confirmation is too old for a deadline-sensitive request");
    else if (leadTime > allowedDays) rejected.push(`Current lead time of ${leadTime} days misses the ${allowedDays}-day requirement`);
    else { score += 15; reasons.push(`Current ${leadTime}-day lead time meets the required date`); }
  } else {
    const currentLeadTime = capability.currentLeadTimeDays ?? capability.standardLeadTimeDays;
    score += Math.max(2, 12 - Math.floor(currentLeadTime / 7));
    reasons.push(`Current lead time is ${currentLeadTime} days`);
  }
  if (capability.capacityStatus === "AVAILABLE") { score += 10; reasons.push("Current capacity is available"); }
  if (capability.capacityStatus === "LIMITED") { score += 4; reasons.push("Current capacity is limited"); }
  if (capability.capacityStatus === "URGENT_ONLY") {
    if (!request.requiredBy) rejected.push("Supplier is accepting urgent work only");
    else { score += 6; reasons.push("Supplier is currently accepting urgent work"); }
  }
  score += coverage.type === "DISTANCE" ? 8 : coverage.type === "POSTCODE" ? 6 : 4;
  const currentLeadTime = capability.currentLeadTimeDays ?? capability.standardLeadTimeDays;
  return {
    outcome: rejected.length ? "REJECTED" as const : "MATCHED" as const,
    score: Math.min(100, Math.max(0, score)),
    reasons: rejected.length ? rejected : reasons,
    signals: {
      capability: rejected.some((reason) => /manufacturer|system|colour|finish|product/i.test(reason)) ? 0 : 1,
      leadTime: rejected.some((reason) => /lead.time|day requirement/i.test(reason)) ? 0 : Math.max(0.2, 1 - currentLeadTime / 180),
      capacity: capability.capacityStatus === "AVAILABLE" ? 1 : capability.capacityStatus === "LIMITED" ? 0.55 : capability.capacityStatus === "URGENT_ONLY" ? 0.7 : 0,
      coverage: 1,
      locality: coverage.distanceMiles !== null ? Math.max(0.1, 1 - coverage.distanceMiles / 150) : coverage.type === "POSTCODE" ? 0.75 : 0.4,
    },
  };
}

export async function evaluateSupplierMatches(
  db: MatchingClient,
  request: RequestForMatching,
  location: DeliveryLocation,
  options: { supplierIds?: string[]; excludeAssigned?: boolean } = {},
): Promise<SupplierEvaluation[]> {
  const now = new Date();
  const configuration = db.matchingConfiguration
    ? await db.matchingConfiguration.findUnique({ where: { id: "default" } })
    : null;
  const weights = matchingWeights(configuration?.matchingWeights);
  const purposeForRequest = ["SERVICE", "INSTALLATION"].includes(request.fulfilmentMode ?? "DELIVERY") ? "SERVICE" as const : "DELIVERY" as const;
  const candidates = await db.supplierCompany.findMany({
    where: {
      id: options.supplierIds ? { in: options.supplierIds } : undefined,
      status: "APPROVED",
      memberships: { some: { role: "OWNER", status: "ACTIVE" } },
      subscription: { is: { status: "ACTIVE", OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }] } },
      assignments: options.excludeAssigned === false ? undefined : { none: { quoteRequestId: request.id } },
    },
    include: {
      coverageAreas: { where: { active: true }, orderBy: { createdAt: "asc" } },
      collectionLocations: { where: { active: true }, orderBy: { createdAt: "asc" } },
      // ProductCategory is RLS-filtered to active rows for the WhatsApp worker.
      // Never ask Prisma to hydrate the required relation for every historical
      // supplier selection: an inactive legacy category is intentionally hidden
      // by RLS and would otherwise make the entire match query fail.
      categories: {
        where: {
          productCategory: { active: true },
          OR: [
            { productCategoryId: request.categoryId },
            { productCategory: { parentId: request.categoryId } },
            { productCategory: { children: { some: { id: request.categoryId, active: true } } } },
          ],
        },
        select: { productCategoryId: true },
      },
      memberships: true,
      subscription: { include: { membershipPlan: true } },
      capabilities: {
        where: {
          active: true,
          OR: [
            { productCategoryId: request.categoryId },
            { productCategory: { parentId: request.categoryId } },
            { productCategory: { children: { some: { id: request.categoryId } } } },
          ],
        },
        orderBy: { lastConfirmedAt: "desc" },
      },
      assignments: {
        where: { assignedAt: { gte: new Date(now.getTime() - 90 * DAY_MS) } },
        select: { status: true, assignedAt: true, respondedAt: true },
      },
      _count: {
        select: {
          assignments: { where: { status: { in: ["PENDING", "VIEWED", "ACCEPTED"] }, expiresAt: { gt: now } } },
          quotations: { where: { status: { in: ["SUBMITTED", "SELECTED_PENDING_PAYMENT", "ACCEPTED"] } } },
        },
      },
    },
    orderBy: { legalName: "asc" },
    take: 250,
  });

  const evaluations: SupplierEvaluation[] = [];
  for (const supplier of candidates) {
    if (!supplierOnboardingReadiness(supplier).ready) continue;
    const plan = supplier.subscription?.membershipPlan;
    const purpose = purposeForRequest;
    const categoryEligible = supplier.categories.length > 0;
    const planLimits = plan ? effectiveMembershipLimits(plan, supplier) : null;
    const configuredRules = supplier.coverageAreas.filter((area) => area.purpose === purpose).map((area) => ({
      ...area,
      radiusMiles: planLimits?.maximumRadiusMiles === null || area.radiusMiles === null ? area.radiusMiles : Math.min(area.radiusMiles, planLimits?.maximumRadiusMiles ?? 0),
    }));
    const collection = request.fulfilmentMode === "COLLECTION" || request.collectionRequired;
    const coverage = collection && supplier.collectionLocations[0]
      ? { type: "POSTCODE" as const, label: supplier.collectionLocations[0].label, description: `Collection from ${supplier.collectionLocations[0].postcode}`, distanceMiles: null }
      : bestCoverageMatch(configuredRules, location);
    const companyDistance = location.latitude !== null && location.longitude !== null && supplier.geographicOriginLatitude !== null && supplier.geographicOriginLongitude !== null
      ? calculateDistanceMiles(
        { latitude: Number(supplier.geographicOriginLatitude), longitude: Number(supplier.geographicOriginLongitude) },
        { latitude: location.latitude, longitude: location.longitude },
      )
      : null;
    const fallbackCoverage: CoverageMatch = { type: "DISTANCE", label: "Outside configured area", description: `Outside configured ${purpose.toLowerCase()} coverage`, distanceMiles: companyDistance };
    const capability = supplier.capabilities[0];
    const base = { id: supplier.id, name: supplier.tradingName ?? supplier.legalName, postcode: supplier.postcode, match: coverage ?? fallbackCoverage, membershipTier: planLimits?.tier ?? null, coveragePurpose: purpose, distanceMiles: coverage?.distanceMiles ?? companyDistance };
    const mandatoryRejections: string[] = [];
    if (purpose === "SERVICE" && configuration?.serviceMatchingEnabled === false) mandatoryRejections.push("Automatic service matching is disabled by an administrator");
    if (purpose === "DELIVERY" && configuration?.deliveryMatchingEnabled === false) mandatoryRejections.push("Automatic delivery matching is disabled by an administrator");
    if (!plan || !planLimits) mandatoryRejections.push("No active configured membership tier");
    if (!categoryEligible) mandatoryRejections.push("Supplier has not selected this product category");
    if (collection && !supplier.collectionLocations.length) mandatoryRejections.push("Collection is required but no active collection location is configured");
    if (!collection && !coverage) mandatoryRejections.push(`Delivery postcode is outside configured ${purpose.toLowerCase()} coverage`);
    if (coverage?.type === "NATIONWIDE" && !planLimits?.nationwideAllowed) mandatoryRejections.push("Membership tier does not allow nationwide coverage");
    if (planLimits && supplier._count.assignments >= planLimits.maximumActiveOpportunities) mandatoryRejections.push(`${plan?.name ?? planLimits.tier} active opportunity limit of ${planLimits.maximumActiveOpportunities} has been reached`);
    if (!capability) {
      evaluations.push({ ...base, outcome: "REJECTED", score: 0, reasons: [...mandatoryRejections, "Supplier has not confirmed capability for this product"], capabilitySnapshot: { missing: true }, rankingSnapshot: { membershipTier: planLimits?.tier ?? null, activeOpportunities: supplier._count.assignments } });
      continue;
    }
    const result = evaluateCapability(request, capability, coverage ?? fallbackCoverage, now, {
      capacityStaleDays: configuration?.capacityStaleDays,
      leadTimeStaleDays: configuration?.leadTimeStaleDays,
    });
    const recentResponses = supplier.assignments.filter((assignment) => assignment.respondedAt).length;
    const responseRate = supplier.assignments.length ? recentResponses / supplier.assignments.length : 0;
    const completionRate = Math.min(1, supplier._count.quotations / Math.max(1, supplier.assignments.length));
    const reliability = supplier.assignments.length ? responseRate : 0.5;
    const weightedPoints = result.signals.capability * weights.capability
      + result.signals.leadTime * weights.leadTime
      + result.signals.capacity * weights.capacity
      + result.signals.coverage * weights.coverage
      + result.signals.locality * weights.locality
      + responseRate * weights.response
      + completionRate * weights.completion
      + reliability * weights.reliability;
    const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0) || 1;
    const score = Math.round(Math.min(100, Math.max(0, weightedPoints / totalWeight * 100)));
    const reasons = mandatoryRejections.length ? mandatoryRejections : [...result.reasons, responseRate > 0 ? `${Math.round(responseRate * 100)}% recent opportunity response rate` : "No response history yet"];
    const outcome = mandatoryRejections.length ? "REJECTED" as const : result.outcome;
    evaluations.push({
      ...base,
      outcome,
      score: outcome === "REJECTED" ? Math.min(score, result.score) : score,
      reasons,
      capabilitySnapshot: {
        capabilityId: capability.id,
        manufacturers: capability.manufacturerNames,
        systems: capability.systemNames,
        colours: capability.colourNames,
        finishes: capability.finishNames,
        standardLeadTimeDays: capability.standardLeadTimeDays,
        urgentLeadTimeDays: capability.urgentLeadTimeDays,
        currentLeadTimeDays: capability.currentLeadTimeDays,
        capacityStatus: capability.capacityStatus,
        capacityLastConfirmedAt: capability.capacityLastConfirmedAt.toISOString(),
        leadTimeLastConfirmedAt: capability.leadTimeLastConfirmedAt.toISOString(),
        lastConfirmedAt: capability.lastConfirmedAt.toISOString(),
      },
      rankingSnapshot: {
        membershipTier: planLimits?.tier ?? null,
        activeOpportunities: supplier._count.assignments,
        maximumActiveOpportunities: planLimits?.maximumActiveOpportunities ?? null,
        responseRate90Days: responseRate,
        submittedQuotationCount: supplier._count.quotations,
        matchingWeights: weights,
        componentSignals: result.signals,
        completionRate90Days: completionRate,
        reliability,
        capacityStaleDays: configuration?.capacityStaleDays ?? DEFAULT_CAPACITY_STALE_DAYS,
        leadTimeStaleDays: configuration?.leadTimeStaleDays ?? DEFAULT_LEAD_TIME_STALE_DAYS,
        coverageType: coverage?.type ?? null,
        distanceMiles: coverage?.distanceMiles ?? null,
      },
    });
  }
  return evaluations.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
}

export async function findSupplierMatches(
  db: MatchingClient,
  request: RequestForMatching,
  location: DeliveryLocation,
  options: { supplierIds?: string[]; excludeAssigned?: boolean; limit?: number } = {},
): Promise<SupplierMatch[]> {
  const evaluations = await evaluateSupplierMatches(db, request, location, options);
  const matches = evaluations.filter((item): item is SupplierEvaluation & { outcome: "MATCHED" } => item.outcome === "MATCHED");
  return options.limit ? matches.slice(0, options.limit) : matches;
}
