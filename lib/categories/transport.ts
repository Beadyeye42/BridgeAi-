import { formatPostcode, normalizePostcode } from "@/lib/location/postcodes";

export const TRANSPORT_CATEGORY_SLUGS = new Set([
  "transport-delivery-removals",
  "man-with-a-van",
  "trade-collection-delivery",
  "same-day-courier",
  "furniture-small-removals",
  "bulky-item-transport",
  "building-material-deliveries",
  "multi-drop-delivery",
]);

const UK_POSTCODE_PATTERN = /\b(?:GIR\s?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?\s?\d[ABD-HJLNP-UW-Z]{2})\b/gi;

export function isTransportCategorySlug(value: string | null | undefined) {
  return Boolean(value && TRANSPORT_CATEGORY_SLUGS.has(value));
}

export function extractUkPostcodes(value: string) {
  return [...new Set(Array.from(value.matchAll(UK_POSTCODE_PATTERN), (match) => formatPostcode(match[0])))];
}

export function resolveTransportCollectionPostcode(input: {
  collectionPostcode?: string | null;
  deliveryPostcode?: string | null;
  evidence: string;
}) {
  if (input.collectionPostcode) return formatPostcode(input.collectionPostcode);

  const labelled = /\b(?:collection(?:\s+postcode)?|collect(?:ion)?\s+from|pick[- ]?up(?:\s+from)?)\b[^\n]{0,100}?\b(GIR\s?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?\s?\d[ABD-HJLNP-UW-Z]{2})\b/i.exec(input.evidence)?.[1];
  if (labelled) return formatPostcode(labelled);

  const destination = input.deliveryPostcode ? normalizePostcode(input.deliveryPostcode) : null;
  return extractUkPostcodes(input.evidence).find((postcode) => normalizePostcode(postcode) !== destination) ?? null;
}

export function matchingCoveragePurpose(input: {
  categorySlug?: string | null;
  fulfilmentMode?: string | null;
}) {
  if (isTransportCategorySlug(input.categorySlug)) return "DELIVERY" as const;
  return ["SERVICE", "INSTALLATION"].includes(input.fulfilmentMode ?? "DELIVERY")
    ? "SERVICE" as const
    : "DELIVERY" as const;
}
