import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({
    error: "Open opportunity claiming has been retired. Bridge-iT now assigns each request to the best capability and capacity matches.",
  }, { status: 410 });
}
