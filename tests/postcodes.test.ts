import { afterEach, describe, expect, it, vi } from "vitest";
import { formatPostcode, lookupPostcode, normalizePostcode, postcodeFromCoordinates, postcodeOutwardCode, PostcodeLookupError } from "../lib/location/postcodes";

afterEach(() => vi.unstubAllGlobals());

describe("UK postcode lookup", () => {
  it("normalises and formats postcode values", () => {
    expect(normalizePostcode(" sw1a 1aa ")).toBe("SW1A1AA");
    expect(formatPostcode("sw1a1aa")).toBe("SW1A 1AA");
    expect(postcodeOutwardCode("gl52 6td")).toBe("GL52");
  });

  it("returns bounded coordinates from Postcodes.io", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 200,
      result: { postcode: "B1 1AA", latitude: 52.479699, longitude: -1.902691 },
    }), { status: 200 })));
    await expect(lookupPostcode("b1 1aa")).resolves.toEqual({ postcode: "B1 1AA", latitude: 52.479699, longitude: -1.902691 });
  });

  it("reports an unknown postcode as invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 404, error: "Invalid postcode" }), { status: 404 })));
    await expect(lookupPostcode("ZZ1 1ZZ")).rejects.toMatchObject({ code: "INVALID_POSTCODE" } satisfies Partial<PostcodeLookupError>);
  });

  it("does not accept a successful response with missing coordinates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 200,
      result: { postcode: "JE1 1AA", latitude: null, longitude: null },
    }), { status: 200 })));
    await expect(lookupPostcode("JE1 1AA")).rejects.toMatchObject({ code: "LOCATION_UNAVAILABLE" } satisfies Partial<PostcodeLookupError>);
  });

  it("maps network failures to a retryable service error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    await expect(lookupPostcode("B1 1AA")).rejects.toMatchObject({ code: "GEOCODING_UNAVAILABLE" } satisfies Partial<PostcodeLookupError>);
  });

  it("fails closed on malformed geocoder data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    await expect(lookupPostcode("B1 1AA")).rejects.toMatchObject({ code: "GEOCODING_UNAVAILABLE" } satisfies Partial<PostcodeLookupError>);
  });

  it("maps a geocoder timeout to a retryable service error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")));
    await expect(lookupPostcode("B1 1AA")).rejects.toMatchObject({ code: "GEOCODING_UNAVAILABLE" } satisfies Partial<PostcodeLookupError>);
  });

  it("finds the nearest postcode for a supplier-selected browser location", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 200,
      result: [{ postcode: "B1 1AA" }],
    }), { status: 200 })));
    await expect(postcodeFromCoordinates(52.479699, -1.902691)).resolves.toEqual({ postcode: "B1 1AA", outwardCode: "B1" });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("limit=1"), expect.objectContaining({ cache: "no-store" }));
  });

  it("rejects invalid browser coordinates before making a lookup", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(postcodeFromCoordinates(200, -1.9)).rejects.toMatchObject({ code: "LOCATION_UNAVAILABLE" } satisfies Partial<PostcodeLookupError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
