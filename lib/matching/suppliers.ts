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
};

export type SupplierMatch = {
  id: string;
  name: string;
  postcode: string | null;
  match: CoverageMatch;
};

export type LocationResolution = {
  location: DeliveryLocation;
  warning: string | null;
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

export async function findSupplierMatches(
  db: MatchingClient,
  request: RequestForMatching,
  location: DeliveryLocation,
  options: { supplierIds?: string[]; excludeAssigned?: boolean; limit?: number } = {},
): Promise<SupplierMatch[]> {
  const now = new Date();
  const where: Prisma.SupplierCompanyWhereInput = {
    id: options.supplierIds ? { in: options.supplierIds } : undefined,
    status: "APPROVED",
    categories: { some: { productCategoryId: request.categoryId } },
    coverageAreas: { some: { active: true } },
    memberships: { some: { role: "OWNER", status: "ACTIVE" } },
    accreditations: {
      some: {
        status: "APPROVED",
        attachment: { is: { scanStatus: "CLEAN" } },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    },
    subscription: {
      is: {
        status: "ACTIVE",
        OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }],
      },
    },
    assignments: options.excludeAssigned === false ? undefined : { none: { quoteRequestId: request.id } },
  };
  const candidates = await db.supplierCompany.findMany({
    where,
    include: {
      coverageAreas: { where: { active: true }, orderBy: { createdAt: "asc" } },
      categories: true,
      memberships: true,
      accreditations: { include: { attachment: true } },
    },
    orderBy: { legalName: "asc" },
    take: 250,
  });

  const matches = candidates.flatMap((supplier) => {
    if (!supplierOnboardingReadiness(supplier, now).ready) return [];
    const match = bestCoverageMatch(supplier.coverageAreas, location);
    return match ? [{
      id: supplier.id,
      name: supplier.tradingName ?? supplier.legalName,
      postcode: supplier.postcode,
      match,
    }] : [];
  });
  const coveragePriority: Record<CoverageMatch["type"], number> = {
    DISTANCE: 0,
    POSTCODE: 1,
    NATIONWIDE: 2,
  };
  matches.sort((left, right) =>
    coveragePriority[left.match.type] - coveragePriority[right.match.type]
    || (left.match.distanceMiles ?? Number.POSITIVE_INFINITY) - (right.match.distanceMiles ?? Number.POSITIVE_INFINITY)
    || left.name.localeCompare(right.name),
  );
  return options.limit ? matches.slice(0, options.limit) : matches;
}
