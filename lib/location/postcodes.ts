import { z } from "zod";

const lookupResponseSchema = z.object({
  status: z.number(),
  result: z.object({
    postcode: z.string(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
  }).optional(),
  error: z.string().optional(),
});

export type PostcodeCoordinates = {
  postcode: string;
  latitude: number;
  longitude: number;
};

export type PostcodeLookupErrorCode = "INVALID_POSTCODE" | "LOCATION_UNAVAILABLE" | "GEOCODING_UNAVAILABLE";

export class PostcodeLookupError extends Error {
  constructor(public readonly code: PostcodeLookupErrorCode, message: string) {
    super(message);
    this.name = "PostcodeLookupError";
  }
}

export function normalizePostcode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function formatPostcode(value: string) {
  const normalized = normalizePostcode(value);
  return normalized.length > 3 ? `${normalized.slice(0, -3)} ${normalized.slice(-3)}` : normalized;
}

export async function lookupPostcode(postcode: string): Promise<PostcodeCoordinates> {
  const normalized = normalizePostcode(postcode);
  if (normalized.length < 5 || normalized.length > 7) {
    throw new PostcodeLookupError("INVALID_POSTCODE", "Enter a complete UK postcode");
  }

  let response: Response;
  try {
    response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(normalized)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new PostcodeLookupError("GEOCODING_UNAVAILABLE", "Postcode lookup is temporarily unavailable. Try again shortly.");
  }

  if (response.status === 404) {
    throw new PostcodeLookupError("INVALID_POSTCODE", "That UK postcode could not be found");
  }
  if (!response.ok) {
    throw new PostcodeLookupError("GEOCODING_UNAVAILABLE", "Postcode lookup is temporarily unavailable. Try again shortly.");
  }

  const parsed = lookupResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.status !== 200 || !parsed.data.result) {
    throw new PostcodeLookupError("GEOCODING_UNAVAILABLE", "Postcode lookup returned an invalid response");
  }

  const { latitude, longitude } = parsed.data.result;
  if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new PostcodeLookupError("LOCATION_UNAVAILABLE", "Distance matching is unavailable for that postcode");
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new PostcodeLookupError("GEOCODING_UNAVAILABLE", "Postcode lookup returned invalid coordinates");
  }

  return { postcode: formatPostcode(parsed.data.result.postcode), latitude, longitude };
}
