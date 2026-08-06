import { Prisma } from "@prisma/client";
import { lookupPostcode, normalizePostcode, PostcodeLookupError } from "../location/postcodes";
import { bestCoverageMatch, type CoverageMatch, type DeliveryLocation } from "./coverage";
import { supplierOnboardingReadiness } from "../suppliers/onboarding";

type MatchingClient = Pick<Prisma.TransactionClient, "supplierCompany">;

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
};

export type SupplierEvaluation = SupplierMatch & {
  outcome: "MATCHED" | "REJECTED";
};

export type LocationResolution = { location: DeliveryLocation; warning: string | null };

const FRESH_DAYS = 14;
const DEADLINE_STALE_LIMIT_DAYS = 14;
const DAY_MS = 86_400_000;

const normalise = (value: string) => value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
const supports = (values: string[], required: string) => {
  const wanted = normalise(required);
  return values.some((value) => {
    const supplied = normalise(value);
    return supplied === "any" || supplied === "all" || supplied === "all standard" || supplied === wanted;
  });
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
  deliveryDays: number[];
  capacityStatus: "AVAILABLE" | "LIMITED" | "URGENT_ONLY" | "FULL" | "PAUSED";
  shortageNote: string | null;
  shortageUntil: Date | null;
  lastConfirmedAt: Date;
};

export function evaluateCapability(request: RequestForMatching, capability: Capability, coverage: CoverageMatch, now = new Date()) {
  const reasons: string[] = [coverage.description];
  const rejected: string[] = [];
  let score = 25;
  if (["FULL", "PAUSED"].includes(capability.capacityStatus)) rejected.push(`Current capacity is ${capability.capacityStatus.toLowerCase()}`);
  if (capability.shortageUntil && capability.shortageUntil > now) rejected.push(`Temporary shortage recorded until ${capability.shortageUntil.toLocaleDateString("en-GB")}`);
  if (request.requiredManufacturer) {
    if (supports(capability.manufacturerNames, request.requiredManufacturer)) { score += 12; reasons.push(`Manufactures ${request.requiredManufacturer}`); }
    else rejected.push(`Does not confirm manufacturer ${request.requiredManufacturer}`);
  }
  if (request.requiredSystem) {
    if (supports(capability.systemNames, request.requiredSystem)) { score += 12; reasons.push(`Offers system ${request.requiredSystem}`); }
    else rejected.push(`Does not confirm system ${request.requiredSystem}`);
  }
  if (request.requiredColour) {
    if (supports(capability.colourNames, request.requiredColour)) { score += 10; reasons.push(`Offers colour ${request.requiredColour}`); }
    else rejected.push(`Does not confirm colour ${request.requiredColour}`);
  }
  if (request.requiredFinish) {
    if (supports(capability.finishNames, request.requiredFinish)) { score += 8; reasons.push(`Offers finish ${request.requiredFinish}`); }
    else rejected.push(`Does not confirm finish ${request.requiredFinish}`);
  }
  if (request.collectionRequired) {
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
  const ageDays = Math.max(0, Math.floor((now.getTime() - capability.lastConfirmedAt.getTime()) / DAY_MS));
  if (ageDays <= FRESH_DAYS) { score += 10; reasons.push(`Availability confirmed ${ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"} ago`}`); }
  else { score = Math.max(0, score - Math.min(20, ageDays - FRESH_DAYS)); reasons.push(`Availability is ${ageDays} days old, so confidence is reduced`); }

  if (request.requiredBy) {
    const allowedDays = Math.max(0, Math.ceil((request.requiredBy.getTime() - now.getTime()) / DAY_MS));
    const leadTime = capability.urgentLeadTimeDays && capability.urgentLeadTimeDays <= allowedDays
      ? capability.urgentLeadTimeDays
      : capability.standardLeadTimeDays;
    if (ageDays > DEADLINE_STALE_LIMIT_DAYS) rejected.push("Lead-time confirmation is too old for a deadline-sensitive request");
    else if (leadTime > allowedDays) rejected.push(`Current lead time of ${leadTime} days misses the ${allowedDays}-day requirement`);
    else { score += 15; reasons.push(`Current ${leadTime}-day lead time meets the required date`); }
  } else {
    score += Math.max(2, 12 - Math.floor(capability.standardLeadTimeDays / 7));
    reasons.push(`Current standard lead time is ${capability.standardLeadTimeDays} days`);
  }
  if (capability.capacityStatus === "AVAILABLE") { score += 10; reasons.push("Current capacity is available"); }
  if (capability.capacityStatus === "LIMITED") { score += 4; reasons.push("Current capacity is limited"); }
  if (capability.capacityStatus === "URGENT_ONLY") {
    if (!request.requiredBy) rejected.push("Supplier is accepting urgent work only");
    else { score += 6; reasons.push("Supplier is currently accepting urgent work"); }
  }
  score += coverage.type === "DISTANCE" ? 8 : coverage.type === "POSTCODE" ? 6 : 4;
  return { outcome: rejected.length ? "REJECTED" as const : "MATCHED" as const, score: Math.min(100, Math.max(0, score)), reasons: rejected.length ? rejected : reasons };
}

export async function evaluateSupplierMatches(
  db: MatchingClient,
  request: RequestForMatching,
  location: DeliveryLocation,
  options: { supplierIds?: string[]; excludeAssigned?: boolean } = {},
): Promise<SupplierEvaluation[]> {
  const now = new Date();
  const candidates = await db.supplierCompany.findMany({
    where: {
      id: options.supplierIds ? { in: options.supplierIds } : undefined,
      status: "APPROVED",
      foundingMemberNumber: { gte: 1, lte: 100 },
      OR: [
        { categories: { some: { productCategoryId: request.categoryId } } },
        { categories: { some: { productCategory: { parentId: request.categoryId } } } },
        {
          categories: {
            some: {
              productCategory: { children: { some: { id: request.categoryId } } },
            },
          },
        },
      ],
      coverageAreas: { some: { active: true } },
      memberships: { some: { role: "OWNER", status: "ACTIVE" } },
      subscription: { is: { status: "ACTIVE", OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }] } },
      assignments: options.excludeAssigned === false ? undefined : { none: { quoteRequestId: request.id } },
    },
    include: {
      coverageAreas: { where: { active: true }, orderBy: { createdAt: "asc" } },
      categories: true,
      memberships: true,
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
    },
    orderBy: { legalName: "asc" },
    take: 250,
  });

  const evaluations: SupplierEvaluation[] = [];
  for (const supplier of candidates) {
    if (!supplierOnboardingReadiness(supplier).ready) continue;
    const coverage = bestCoverageMatch(supplier.coverageAreas, location);
    if (!coverage) continue;
    const capability = supplier.capabilities[0];
    const base = { id: supplier.id, name: supplier.tradingName ?? supplier.legalName, postcode: supplier.postcode, match: coverage };
    if (!capability) {
      evaluations.push({ ...base, outcome: "REJECTED", score: 0, reasons: ["Supplier has not confirmed capability for this product"], capabilitySnapshot: { missing: true } });
      continue;
    }
    const result = evaluateCapability(request, capability, coverage, now);
    evaluations.push({
      ...base,
      ...result,
      capabilitySnapshot: {
        capabilityId: capability.id,
        manufacturers: capability.manufacturerNames,
        systems: capability.systemNames,
        colours: capability.colourNames,
        finishes: capability.finishNames,
        standardLeadTimeDays: capability.standardLeadTimeDays,
        urgentLeadTimeDays: capability.urgentLeadTimeDays,
        capacityStatus: capability.capacityStatus,
        lastConfirmedAt: capability.lastConfirmedAt.toISOString(),
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
