import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupplierApi } from "@/lib/auth/api";
import { postcodeFromCoordinates, PostcodeLookupError } from "@/lib/location/postcodes";

const coordinatesSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export async function POST(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const parsed = coordinatesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Your current location could not be read" }, { status: 400 });

  try {
    const location = await postcodeFromCoordinates(parsed.data.latitude, parsed.data.longitude);
    return NextResponse.json(location);
  } catch (error) {
    if (error instanceof PostcodeLookupError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "GEOCODING_UNAVAILABLE" ? 503 : 422 });
    }
    return NextResponse.json({ error: "Location lookup is temporarily unavailable. Enter your postcode instead." }, { status: 503 });
  }
}
