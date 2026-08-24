import { Prisma } from "@prisma/client";
import { lookupPostcode, normalizePostcode, PostcodeLookupError } from "../location/postcodes";
import { bestCoverageMatch, distanceMiles as calculateDistanceMiles, type CoverageMatch, type DeliveryLocation } from "./coverage";
import { isWithinGeographicRadius } from "./geographic-boundary";
import { supplierOnboardingReadiness } from "../suppliers/onboarding";
import {
  isRalCode,
  isRalColourMarker,
  isStandardColour,
  normaliseCapabilityValue,
} from "../capabilities/options";
import { effectiveMembershipLimits } from "../billing/membership-plans";
import { buyerTypeAllowed, buyerTypeLabel, type BuyerTypeValue } from "../whatsapp/buyer-classification";
import { hyperlocalService, type RequestUrgency } from "../categories/hyperlocal-industries";
import { matchingCoveragePurpose } from "../categories/transport";

type MatchingClient = Pick<Prisma.TransactionClient, "supplierCompany"> & Partial<Pick<Prisma.TransactionClient, "matchingConfiguration" | "productCategory">>;

type RequestForMatching = {
  id: string;
  categoryId: string;
  buyerType?: BuyerTypeValue;
  deliveryPostcode: string;
  deliveryLatitude: Prisma.Decimal | number | null;
  deliveryLongitude: Prisma.Decimal | number | null;
  matchingPostcode?: string | null;
  matchingLatitude?: Prisma.Decimal | number | null;
  matchingLongitude?: Prisma.Decimal | number | null;
  matchingCoveragePurpose?: "SERVICE" | "DELIVERY" | null;
  customerBudget?: Prisma.Decimal | number | null;
  requiredManufacturer?: string | null;
  requiredSystem?: string | null;
  requiredColour?: string | null;
  requiredFinish?: string | null;
  requiredBy?: Date | null;
  urgency?: RequestUrgency;
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
  membershipTier?: "HYPERLOCAL" | "LOCAL" | "REGIONAL" | "NATIONWIDE" | null;
  coveragePurpose?: "SERVICE" | "DELIVERY" | null;
  distanceMiles?: number | null;
  rankingSnapshot?: Prisma.InputJsonValue;
  baseScore: number;
  fairnessAdjustment: number;
  marketDensityMode: MarketDensityModeValue;
  invitationReason: string | null;
  rejectionReason: string | null;
  softCapOverride: boolean;
  exposure: SupplierExposure;
};

export type SupplierEvaluation = SupplierMatch & {
  outcome: "MATCHED" | "REJECTED";
  mandatoryEligible: boolean;
};

export type LocationResolution = { location: DeliveryLocation; warning: string | null };

const DEFAULT_CAPACITY_STALE_DAYS = 7;
const DEFAULT_LEAD_TIME_STALE_DAYS = 14;
const DAY_MS = 86_400_000;

export type MarketDensityModeValue = "EMPTY" | "SPARSE" | "HEALTHY" | "DENSE";
export type SupplierExposure = {
  invitations7Days: number;
  invitations30Days: number;
  quotes30Days: number;
  wins30Days: number;
  declines30Days: number;
  expiries30Days: number;
  currentActiveOpportunities: number;
};

type AdaptiveMatchingConfiguration = {
  sparseMarketMaximumEligible: number;
  healthyMarketMaximumEligible: number;
  sparseFairnessWeight: number;
  healthyFairnessWeight: number;
  denseFairnessWeight: number;
  fairnessSimilarityBandPoints: number;
  sparseSoftCapEnabled: boolean;
  healthySoftCapExtraOpportunities: number;
  respectDeclaredMonthlyCapacity: boolean;
  declaredCapacityWarningPercent: number;
};

const DEFAULT_ADAPTIVE_CONFIGURATION: AdaptiveMatchingConfiguration = {
  sparseMarketMaximumEligible: 4,
  healthyMarketMaximumEligible: 10,
  sparseFairnessWeight: 2,
  healthyFairnessWeight: 5,
  denseFairnessWeight: 10,
  fairnessSimilarityBandPoints: 5,
  sparseSoftCapEnabled: true,
  healthySoftCapExtraOpportunities: 1,
  respectDeclaredMonthlyCapacity: true,
  declaredCapacityWarningPercent: 80,
};

export function marketDensityMode(eligibleSupplierCount: number, configuration: Pick<AdaptiveMatchingConfiguration, "sparseMarketMaximumEligible" | "healthyMarketMaximumEligible"> = DEFAULT_ADAPTIVE_CONFIGURATION): MarketDensityModeValue {
  if (eligibleSupplierCount === 0) return "EMPTY";
  if (eligibleSupplierCount <= configuration.sparseMarketMaximumEligible) return "SPARSE";
  if (eligibleSupplierCount <= configuration.healthyMarketMaximumEligible) return "HEALTHY";
  return "DENSE";
}

function adaptiveConfiguration(value: Partial<AdaptiveMatchingConfiguration> | null | undefined): AdaptiveMatchingConfiguration {
  return {
    sparseMarketMaximumEligible: value?.sparseMarketMaximumEligible ?? DEFAULT_ADAPTIVE_CONFIGURATION.sparseMarketMaximumEligible,
    healthyMarketMaximumEligible: value?.healthyMarketMaximumEligible ?? DEFAULT_ADAPTIVE_CONFIGURATION.healthyMarketMaximumEligible,
    sparseFairnessWeight: value?.sparseFairnessWeight ?? DEFAULT_ADAPTIVE_CONFIGURATION.sparseFairnessWeight,
    healthyFairnessWeight: value?.healthyFairnessWeight ?? DEFAULT_ADAPTIVE_CONFIGURATION.healthyFairnessWeight,
    denseFairnessWeight: value?.denseFairnessWeight ?? DEFAULT_ADAPTIVE_CONFIGURATION.denseFairnessWeight,
    fairnessSimilarityBandPoints: value?.fairnessSimilarityBandPoints ?? DEFAULT_ADAPTIVE_CONFIGURATION.fairnessSimilarityBandPoints,
    sparseSoftCapEnabled: value?.sparseSoftCapEnabled ?? DEFAULT_ADAPTIVE_CONFIGURATION.sparseSoftCapEnabled,
    healthySoftCapExtraOpportunities: value?.healthySoftCapExtraOpportunities ?? DEFAULT_ADAPTIVE_CONFIGURATION.healthySoftCapExtraOpportunities,
    respectDeclaredMonthlyCapacity: value?.respectDeclaredMonthlyCapacity ?? DEFAULT_ADAPTIVE_CONFIGURATION.respectDeclaredMonthlyCapacity,
    declaredCapacityWarningPercent: value?.declaredCapacityWarningPercent ?? DEFAULT_ADAPTIVE_CONFIGURATION.declaredCapacityWarningPercent,
  };
}

export function exposureFairnessAdjustment({
  density,
  baseScore,
  bestBaseScore,
  invitations30Days,
  maximumInvitations30Days,
  configuration = DEFAULT_ADAPTIVE_CONFIGURATION,
}: {
  density: MarketDensityModeValue;
  baseScore: number;
  bestBaseScore: number;
  invitations30Days: number;
  maximumInvitations30Days: number;
  configuration?: AdaptiveMatchingConfiguration;
}) {
  if (density === "EMPTY" || bestBaseScore - baseScore > configuration.fairnessSimilarityBandPoints || maximumInvitations30Days <= 0) return 0;
  const weight = density === "SPARSE"
    ? configuration.sparseFairnessWeight
    : density === "HEALTHY"
      ? configuration.healthyFairnessWeight
      : configuration.denseFairnessWeight;
  return Number((weight * Math.max(0, 1 - invitations30Days / maximumInvitations30Days)).toFixed(2));
}

export function adaptiveOpportunityAccess({
  density,
  currentActiveOpportunities,
  maximumActiveOpportunities,
  configuration,
}: {
  density: MarketDensityModeValue;
  currentActiveOpportunities: number;
  maximumActiveOpportunities: number;
  configuration?: Partial<Pick<AdaptiveMatchingConfiguration, "sparseSoftCapEnabled" | "healthySoftCapExtraOpportunities">>;
}) {
  const configured = adaptiveConfiguration(configuration);
  if (maximumActiveOpportunities < 1) return { allowed: false, softCapOverride: false, effectiveLimit: 0 };
  if (density === "SPARSE" && configured.sparseSoftCapEnabled) {
    return { allowed: true, softCapOverride: currentActiveOpportunities >= maximumActiveOpportunities, effectiveLimit: null };
  }
  const effectiveLimit = density === "HEALTHY"
    ? maximumActiveOpportunities + configured.healthySoftCapExtraOpportunities
    : maximumActiveOpportunities;
  return {
    allowed: currentActiveOpportunities < effectiveLimit,
    softCapOverride: false,
    effectiveLimit,
  };
}

export function selectAdaptiveSupplierMatches<T extends Pick<SupplierEvaluation, "outcome">>(evaluations: T[], limit = 5) {
  return evaluations.filter((evaluation) => evaluation.outcome === "MATCHED").slice(0, Math.max(0, Math.min(5, limit)));
}

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

export async function resolveDeliveryLocation(request: Pick<RequestForMatching, "deliveryPostcode" | "deliveryLatitude" | "deliveryLongitude" | "matchingPostcode" | "matchingLatitude" | "matchingLongitude">): Promise<LocationResolution> {
  const postcode = request.matchingPostcode ?? request.deliveryPostcode;
  const rawLatitude = request.matchingLatitude ?? request.deliveryLatitude;
  const rawLongitude = request.matchingLongitude ?? request.deliveryLongitude;
  const latitude = rawLatitude === null ? null : Number(rawLatitude);
  const longitude = rawLongitude === null ? null : Number(rawLongitude);
  if (latitude !== null && longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { location: { postcode: normalizePostcode(postcode), latitude, longitude }, warning: null };
  }
  try {
    const result = await lookupPostcode(postcode);
    return { location: { postcode: normalizePostcode(result.postcode), latitude: result.latitude, longitude: result.longitude }, warning: null };
  } catch (error) {
    const warning = error instanceof PostcodeLookupError
      ? `${error.message} Distance-radius suppliers cannot be matched until the delivery postcode is resolved.`
      : "Distance matching is temporarily unavailable.";
    return { location: { postcode: normalizePostcode(postcode), latitude: null, longitude: null }, warning };
  }
}

type Capability = {
  id: string;
  servesConsumer?: boolean;
  servesTrade?: boolean;
  servesBusiness?: boolean;
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
  liveAvailability?: "AVAILABLE_NOW" | "AVAILABLE_TODAY" | "AVAILABLE_TOMORROW" | "LIMITED" | "FULLY_BOOKED" | "PAUSED" | "HOLIDAY";
  nextAvailableAt?: Date | null;
  availabilityLastConfirmedAt?: Date;
  capacityLastConfirmedAt?: Date;
  leadTimeLastConfirmedAt?: Date;
  currentLeadTimeDays?: number | null;
  declaredMonthlyCapacity?: number | null;
  shortageNote: string | null;
  shortageUntil: Date | null;
  lastConfirmedAt: Date;
};

type VerificationEvidence = {
  type: "PUBLIC_LIABILITY_INSURANCE" | "EMPLOYERS_LIABILITY_INSURANCE" | "PROFESSIONAL_INDEMNITY_INSURANCE" | "TRADE_BODY_MEMBERSHIP" | "CERTIFICATION" | "OTHER";
  displayName: string;
  issuingBody: string | null;
  referenceNumber: string | null;
};

const credentialPatterns: Record<string, RegExp> = {
  regulated_heating_credential: /gas\s*safe|oftec|mcs|heating|boiler/i,
  relevant_cylinder_credential: /\bg3\b|unvented|cylinder/i,
  relevant_refrigerant_credential: /f[ -]?gas|refrigerant/i,
  waste_carrier_evidence: /waste\s*carrier|environment\s*agency/i,
  specialist_tree_evidence: /arbor|tree|nptc|lantra/i,
  relevant_gas_or_electrical_evidence: /gas\s*safe|niceic|napit|electrical|part\s*p/i,
};

export function missingVerificationRequirements(input: {
  requirements: readonly string[];
  status: "PENDING" | "APPROVED" | "SUSPENDED" | "REJECTED";
  companyNumber: string | null;
  addressLine1: string | null;
  postcode: string | null;
  accreditations: VerificationEvidence[];
}) {
  const evidence = input.accreditations.map((entry) => `${entry.displayName} ${entry.issuingBody ?? ""} ${entry.referenceNumber ?? ""}`.trim());
  return input.requirements.filter((requirement) => {
    if (requirement === "admin_approval") return input.status !== "APPROVED";
    if (["business_check", "identity_business_check"].includes(requirement)) return !input.companyNumber;
    if (requirement === "verified_business_address") return !input.addressLine1 || !input.postcode;
    if (requirement === "insurance") {
      return !input.accreditations.some((entry) => [
        "PUBLIC_LIABILITY_INSURANCE",
        "EMPLOYERS_LIABILITY_INSURANCE",
        "PROFESSIONAL_INDEMNITY_INSURANCE",
      ].includes(entry.type));
    }
    const pattern = credentialPatterns[requirement];
    return pattern ? !evidence.some((value) => pattern.test(value)) : true;
  });
}

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
  const buyerType = request.buyerType ?? "TRADE";
  if (!buyerTypeAllowed(buyerType, capability)) rejected.push(`Supplier does not serve ${buyerTypeLabel(buyerType).toLocaleLowerCase("en-GB")} requests for this product`);
  else reasons.push(`Accepts ${buyerTypeLabel(buyerType).toLocaleLowerCase("en-GB")} requests for this product`);
  if (["FULL", "PAUSED", "HOLIDAY", "NOT_ACCEPTING"].includes(capability.capacityStatus)) rejected.push(`Current capacity is ${capability.capacityStatus.toLowerCase().replaceAll("_", " ")}`);
  if (["FULLY_BOOKED", "PAUSED", "HOLIDAY"].includes(capability.liveAvailability ?? "AVAILABLE_TODAY")) {
    rejected.push(`Live availability is ${(capability.liveAvailability ?? "PAUSED").toLowerCase().replaceAll("_", " ")}`);
  }
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
  const availabilityConfirmedAt = capability.availabilityLastConfirmedAt ?? capacityConfirmedAt;
  const leadTimeConfirmedAt = capability.leadTimeLastConfirmedAt ?? capability.lastConfirmedAt;
  const ageDays = Math.max(0, Math.floor((now.getTime() - capacityConfirmedAt.getTime()) / DAY_MS));
  const leadTimeAgeDays = Math.max(0, Math.floor((now.getTime() - leadTimeConfirmedAt.getTime()) / DAY_MS));
  const availabilityAgeDays = Math.max(0, Math.floor((now.getTime() - availabilityConfirmedAt.getTime()) / DAY_MS));
  if (ageDays <= capacityStaleDays) { score += 10; reasons.push(`Availability confirmed ${ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"} ago`}`); }
  else { score = Math.max(0, score - Math.min(20, ageDays - capacityStaleDays)); reasons.push(`Availability is ${ageDays} days old, so confidence is reduced`); }

  const urgentRequest = ["EMERGENCY", "WITHIN_2_HOURS", "SAME_DAY"].includes(request.urgency ?? "FLEXIBLE");
  if (urgentRequest && availabilityAgeDays > capacityStaleDays) rejected.push("Live availability is too old for an urgent request");
  if (request.urgency === "EMERGENCY" || request.urgency === "WITHIN_2_HOURS") {
    if (capability.liveAvailability !== "AVAILABLE_NOW") rejected.push("Supplier has not confirmed immediate availability");
  } else if (request.urgency === "SAME_DAY" && !["AVAILABLE_NOW", "AVAILABLE_TODAY"].includes(capability.liveAvailability ?? "AVAILABLE_TODAY")) {
    rejected.push("Supplier has not confirmed same-day availability");
  } else if (request.urgency === "NEXT_DAY" && !["AVAILABLE_NOW", "AVAILABLE_TODAY", "AVAILABLE_TOMORROW"].includes(capability.liveAvailability ?? "AVAILABLE_TODAY")) {
    rejected.push("Supplier has not confirmed next-day availability");
  }
  if (request.requiredBy && capability.nextAvailableAt && capability.nextAvailableAt > request.requiredBy) {
    rejected.push(`Next appointment is after the customer's required date`);
  }
  if (!rejected.some((reason) => /availability/i.test(reason))) {
    score += capability.liveAvailability === "AVAILABLE_NOW" ? 10 : capability.liveAvailability === "AVAILABLE_TODAY" ? 8 : capability.liveAvailability === "AVAILABLE_TOMORROW" ? 5 : 2;
    reasons.push(`Live availability is ${(capability.liveAvailability ?? "AVAILABLE_TODAY").toLowerCase().replaceAll("_", " ")}`);
  }

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
      capacity: ["FULLY_BOOKED", "PAUSED", "HOLIDAY"].includes(capability.liveAvailability ?? "AVAILABLE_TODAY")
        ? 0
        : capability.liveAvailability === "AVAILABLE_NOW"
          ? 1
          : capability.capacityStatus === "AVAILABLE" ? 0.85 : capability.capacityStatus === "LIMITED" ? 0.55 : capability.capacityStatus === "URGENT_ONLY" ? 0.7 : 0,
      coverage: 1,
      locality: coverage.distanceMiles !== null ? Math.max(0.1, 1 - coverage.distanceMiles / 150) : coverage.type === "POSTCODE" ? 0.75 : 0.4,
    },
  };
}

export async function evaluateSupplierMatches(
  db: MatchingClient,
  request: RequestForMatching,
  location: DeliveryLocation,
  options: { supplierIds?: string[]; excludeAssigned?: boolean; capacityOverrideSupplierIds?: string[] } = {},
): Promise<SupplierEvaluation[]> {
  const now = new Date();
  const configuration = db.matchingConfiguration
    ? await db.matchingConfiguration.findUnique({ where: { id: "default" } })
    : null;
  let weights = matchingWeights(configuration?.matchingWeights);
  const requestCategory = db.productCategory ? await db.productCategory.findUnique({
    where: { id: request.categoryId },
    select: {
      name: true, slug: true, servesConsumer: true, servesTrade: true, servesBusiness: true, hyperlocalEnabled: true,
      parent: { select: { name: true, servesConsumer: true, servesTrade: true, servesBusiness: true, hyperlocalEnabled: true } },
    },
  }) : { name: "Legacy industry", slug: "legacy", servesConsumer: false, servesTrade: true, servesBusiness: true, hyperlocalEnabled: false, parent: null };
  const hyperlocal = hyperlocalService(requestCategory?.slug);
  if (hyperlocal) {
    const configured = hyperlocal.service.matchingWeights;
    weights = {
      capability: configured.capability,
      leadTime: Math.round(configured.availability * 0.45),
      capacity: Math.round(configured.availability * 0.55),
      coverage: Math.round(configured.location * 0.45),
      locality: Math.round(configured.location * 0.55),
      response: configured.response,
      completion: Math.round(configured.performance * 0.6),
      reliability: Math.round(configured.performance * 0.4),
    };
  }
  const industry = requestCategory?.parent ?? requestCategory;
  const buyerType = request.buyerType ?? "TRADE";
  const purposeForRequest = request.matchingCoveragePurpose ?? matchingCoveragePurpose({
    categorySlug: requestCategory?.slug,
    fulfilmentMode: request.fulfilmentMode,
  });
  const candidates = await db.supplierCompany.findMany({
    where: {
      status: "APPROVED",
      memberships: { some: { role: "OWNER", status: "ACTIVE" } },
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
      accreditations: {
        where: { status: "APPROVED", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        select: { type: true, displayName: true, issuingBody: true, referenceNumber: true },
      },
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
      quotations: {
        where: { createdAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } },
        select: { status: true, submittedAt: true, decidedAt: true, createdAt: true },
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
    const subscriptionActive = supplier.subscription?.status === "ACTIVE"
      && (supplier.subscription.currentPeriodEnd === null || supplier.subscription.currentPeriodEnd > now);
    const purpose = purposeForRequest;
    const categoryEligible = supplier.categories.length > 0;
    const planLimits = plan ? effectiveMembershipLimits(plan, supplier) : null;
    const purposeRadius = planLimits
      ? purpose === "SERVICE"
        ? planLimits.maximumServiceRadiusMiles
        : planLimits.maximumDeliveryRadiusMiles
      : null;
    const configuredRules = supplier.coverageAreas.filter((area) => area.purpose === purpose).map((area) => ({
      ...area,
      radiusMiles: purposeRadius === null || area.radiusMiles === null ? area.radiusMiles : Math.min(area.radiusMiles, purposeRadius ?? 0),
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
    const exposure: SupplierExposure = {
      invitations7Days: supplier.assignments.filter((assignment) => assignment.assignedAt >= new Date(now.getTime() - 7 * DAY_MS)).length,
      invitations30Days: supplier.assignments.filter((assignment) => assignment.assignedAt >= new Date(now.getTime() - 30 * DAY_MS)).length,
      quotes30Days: supplier.quotations.filter((quotation) => quotation.submittedAt !== null).length,
      wins30Days: supplier.quotations.filter((quotation) => quotation.status === "ACCEPTED").length,
      declines30Days: supplier.assignments.filter((assignment) => assignment.assignedAt >= new Date(now.getTime() - 30 * DAY_MS) && assignment.status === "DECLINED").length,
      expiries30Days: supplier.assignments.filter((assignment) => assignment.assignedAt >= new Date(now.getTime() - 30 * DAY_MS) && assignment.status === "EXPIRED").length,
      currentActiveOpportunities: supplier._count.assignments,
    };
    const base = {
      id: supplier.id,
      name: supplier.tradingName ?? supplier.legalName,
      postcode: supplier.postcode,
      match: coverage ?? fallbackCoverage,
      membershipTier: planLimits?.tier ?? null,
      coveragePurpose: purpose,
      distanceMiles: companyDistance ?? coverage?.distanceMiles ?? null,
      marketDensityMode: "EMPTY" as MarketDensityModeValue,
      baseScore: 0,
      fairnessAdjustment: 0,
      invitationReason: null,
      rejectionReason: null,
      softCapOverride: false,
      exposure,
    };
    const mandatoryRejections: string[] = [];
    if (!industry) mandatoryRejections.push("Request industry is unavailable");
    else if (!buyerTypeAllowed(buyerType, industry)) mandatoryRejections.push(`${industry.name} is not open to ${buyerTypeLabel(buyerType).toLocaleLowerCase("en-GB")} requests`);
    if (purpose === "SERVICE" && configuration?.serviceMatchingEnabled === false) mandatoryRejections.push("Automatic service matching is disabled by an administrator");
    if (purpose === "DELIVERY" && configuration?.deliveryMatchingEnabled === false) mandatoryRejections.push("Automatic delivery matching is disabled by an administrator");
    if (!subscriptionActive) mandatoryRejections.push("An active supplier subscription is required");
    if (!plan || !planLimits) mandatoryRejections.push("No active configured membership tier");
    if (planLimits?.tier === "HYPERLOCAL" && !industry?.hyperlocalEnabled) mandatoryRejections.push("Hyperlocal membership is not enabled for this request industry");
    if (!categoryEligible) mandatoryRejections.push("Supplier has not selected this product category");
    if (collection && !supplier.collectionLocations.length) mandatoryRejections.push("Collection is required but no active collection location is configured");
    if (!collection && !coverage) mandatoryRejections.push(`Delivery postcode is outside configured ${purpose.toLowerCase()} coverage`);
    if (coverage?.type === "NATIONWIDE" && !planLimits?.nationwideAllowed) mandatoryRejections.push("Membership tier does not allow nationwide coverage");
    if (planLimits && purposeRadius !== null && companyDistance === null) mandatoryRejections.push("Registered company-base coordinates are required for mileage-controlled matching");
    if (planLimits && purposeRadius !== null && companyDistance !== null && !isWithinGeographicRadius(companyDistance, purposeRadius)) {
      mandatoryRejections.push(`${plan?.name ?? planLimits.tier} is limited to ${purposeRadius} miles from the registered company base`);
    }
    const missingVerification = hyperlocal ? missingVerificationRequirements({
      requirements: hyperlocal.service.verification,
      status: supplier.status,
      companyNumber: supplier.companyNumber,
      addressLine1: supplier.addressLine1,
      postcode: supplier.postcode,
      accreditations: supplier.accreditations,
    }) : [];
    if (missingVerification.length) {
      mandatoryRejections.push(`Required supplier verification is missing: ${missingVerification.join(", ").replaceAll("_", " ")}`);
    }
    if (!capability) {
      const reasons = [...mandatoryRejections, "Supplier has not confirmed capability for this product"];
      evaluations.push({
        ...base,
        outcome: "REJECTED",
        mandatoryEligible: false,
        score: 0,
        reasons,
        rejectionReason: reasons[0] ?? "Supplier capability is incomplete",
        capabilitySnapshot: { missing: true },
        rankingSnapshot: { membershipTier: planLimits?.tier ?? null, activeOpportunities: supplier._count.assignments, exposure },
      });
      continue;
    }
    const capacityOverride = options.capacityOverrideSupplierIds?.includes(supplier.id) ?? false;
    const capabilityForEvaluation = capacityOverride ? { ...capability, capacityStatus: "AVAILABLE" as const } : capability;
    const result = evaluateCapability(request, capabilityForEvaluation, coverage ?? fallbackCoverage, now, {
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
    const geographyReason = companyDistance !== null && purposeRadius !== null
      ? `${companyDistance.toFixed(1)} miles from registered company base, within the ${purposeRadius}-mile ${plan?.name ?? planLimits?.tier} limit`
      : null;
    const reasons = mandatoryRejections.length ? mandatoryRejections : [...result.reasons, ...(capacityOverride ? ["Operational capacity override authorised by an administrator"] : []), ...(geographyReason ? [geographyReason] : []), responseRate > 0 ? `${Math.round(responseRate * 100)}% recent opportunity response rate` : "No response history yet"];
    const outcome = mandatoryRejections.length ? "REJECTED" as const : result.outcome;
    const mandatoryEligible = outcome === "MATCHED";
    evaluations.push({
      ...base,
      outcome,
      mandatoryEligible,
      score: outcome === "REJECTED" ? Math.min(score, result.score) : score,
      baseScore: outcome === "REJECTED" ? Math.min(score, result.score) : score,
      reasons,
      rejectionReason: outcome === "REJECTED" ? reasons[0] ?? "Mandatory eligibility requirements were not met" : null,
      capabilitySnapshot: {
        capabilityId: capability.id,
        buyerType,
        servesConsumer: capability.servesConsumer ?? false,
        servesTrade: capability.servesTrade ?? true,
        servesBusiness: capability.servesBusiness ?? true,
        manufacturers: capability.manufacturerNames,
        systems: capability.systemNames,
        colours: capability.colourNames,
        finishes: capability.finishNames,
        standardLeadTimeDays: capability.standardLeadTimeDays,
        urgentLeadTimeDays: capability.urgentLeadTimeDays,
        currentLeadTimeDays: capability.currentLeadTimeDays,
        capacityStatus: capability.capacityStatus,
        liveAvailability: capability.liveAvailability,
        nextAvailableAt: capability.nextAvailableAt?.toISOString() ?? null,
        availabilityLastConfirmedAt: capability.availabilityLastConfirmedAt?.toISOString() ?? null,
        capacityLastConfirmedAt: capability.capacityLastConfirmedAt.toISOString(),
        leadTimeLastConfirmedAt: capability.leadTimeLastConfirmedAt.toISOString(),
        lastConfirmedAt: capability.lastConfirmedAt.toISOString(),
        declaredMonthlyCapacity: capability.declaredMonthlyCapacity,
        capacityOverride,
        verificationRequirements: hyperlocal?.service.verification ?? [],
        verificationRequirementsMet: missingVerification.length === 0,
      },
      rankingSnapshot: {
        membershipTier: planLimits?.tier ?? null,
        buyerType,
        industryAudienceAllowed: Boolean(industry && buyerTypeAllowed(buyerType, industry)),
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
        distanceMilesFromCompanyBase: companyDistance,
        effectiveRadiusMiles: purposeRadius,
        exposure,
        declaredMonthlyCapacity: capability.declaredMonthlyCapacity,
        capacityOverride,
      },
    });
  }
  const adaptive = adaptiveConfiguration(configuration);
  const mandatoryEligible = evaluations.filter((evaluation) => evaluation.mandatoryEligible);
  const density = marketDensityMode(mandatoryEligible.length, adaptive);
  const bestBaseScore = mandatoryEligible.reduce((best, evaluation) => Math.max(best, evaluation.baseScore), 0);
  const maximumInvitations30Days = mandatoryEligible.reduce((maximum, evaluation) => Math.max(maximum, evaluation.exposure.invitations30Days), 0);
  const adjusted = evaluations.map((evaluation): SupplierEvaluation => {
    if (!evaluation.mandatoryEligible) return { ...evaluation, marketDensityMode: density };
    const maximumActive = Number((evaluation.rankingSnapshot as Record<string, unknown> | null)?.maximumActiveOpportunities ?? 0);
    const currentActive = evaluation.exposure.currentActiveOpportunities;
    const access = adaptiveOpportunityAccess({
      density,
      currentActiveOpportunities: currentActive,
      maximumActiveOpportunities: maximumActive,
      configuration: adaptive,
    });
    const softCapOverride = access.softCapOverride;
    if (!access.allowed) {
      const rejectionReason = `${evaluation.membershipTier ?? "Membership"} active opportunity limit reached for this ${density.toLowerCase()} market`;
      return {
        ...evaluation,
        outcome: "REJECTED",
        marketDensityMode: density,
        rejectionReason,
        reasons: [rejectionReason],
      };
    }
    const fairnessAdjustment = exposureFairnessAdjustment({
      density,
      baseScore: evaluation.baseScore,
      bestBaseScore,
      invitations30Days: evaluation.exposure.invitations30Days,
      maximumInvitations30Days,
      configuration: adaptive,
    });
    const snapshot = (evaluation.rankingSnapshot && typeof evaluation.rankingSnapshot === "object" && !Array.isArray(evaluation.rankingSnapshot)
      ? evaluation.rankingSnapshot
      : {}) as Record<string, Prisma.JsonValue>;
    const declaredMonthlyCapacity = Number(snapshot.declaredMonthlyCapacity ?? 0);
    const capacityUsePercent = declaredMonthlyCapacity > 0
      ? Math.round(evaluation.exposure.invitations30Days / declaredMonthlyCapacity * 100)
      : null;
    const capacityAdjustment = adaptive.respectDeclaredMonthlyCapacity && capacityUsePercent !== null && capacityUsePercent >= adaptive.declaredCapacityWarningPercent
      ? Math.min(density === "DENSE" ? 6 : density === "HEALTHY" ? 3 : 1, Math.max(1, Math.floor(capacityUsePercent / 50)))
      : 0;
    const score = Math.round(Math.min(100, Math.max(0, evaluation.baseScore + fairnessAdjustment - capacityAdjustment)));
    const fairnessText = fairnessAdjustment > 0 ? `Exposure fairness added ${fairnessAdjustment.toFixed(1)} points among similarly qualified suppliers` : null;
    const capacityText = capacityAdjustment > 0 ? `Declared monthly capacity is ${capacityUsePercent}% allocated, so ranking was reduced without blocking eligibility` : null;
    const invitationReason = [
      `${density.toLowerCase()} market with ${mandatoryEligible.length} eligible supplier${mandatoryEligible.length === 1 ? "" : "s"}`,
      softCapOverride ? "buyer-fulfilment sparse-market override applied" : null,
      fairnessText,
      capacityText,
    ].filter(Boolean).join("; ");
    return {
      ...evaluation,
      outcome: "MATCHED",
      score,
      fairnessAdjustment,
      marketDensityMode: density,
      invitationReason,
      softCapOverride,
      reasons: [...evaluation.reasons, ...(fairnessText ? [fairnessText] : []), ...(capacityText ? [capacityText] : [])],
      rankingSnapshot: {
        ...snapshot,
        marketDensityMode: density,
        eligibleSupplierCount: mandatoryEligible.length,
        baseScore: evaluation.baseScore,
        fairnessAdjustment,
        capacityAdjustment,
        capacityUsePercent,
        softCapOverride,
      },
    };
  });
  const selectedSet = options.supplierIds ? new Set(options.supplierIds) : null;
  return adjusted
    .filter((evaluation) => !selectedSet || selectedSet.has(evaluation.id))
    .sort((left, right) => right.score - left.score || right.baseScore - left.baseScore || left.name.localeCompare(right.name));
}

export async function findSupplierMatches(
  db: MatchingClient,
  request: RequestForMatching,
  location: DeliveryLocation,
  options: { supplierIds?: string[]; excludeAssigned?: boolean; limit?: number; capacityOverrideSupplierIds?: string[] } = {},
): Promise<SupplierMatch[]> {
  const evaluations = await evaluateSupplierMatches(db, request, location, options);
  const matches = selectAdaptiveSupplierMatches(evaluations, options.limit ?? 5);
  return options.limit ? matches : evaluations.filter((item): item is SupplierEvaluation & { outcome: "MATCHED" } => item.outcome === "MATCHED");
}
