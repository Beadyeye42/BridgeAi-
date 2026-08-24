import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Query-string callbacks were replaced by a fragment-based verifier so
  // login secrets cannot reach infrastructure access logs or referrers.
  return NextResponse.redirect(new URL("/buyer/login?auth=invalid", url.origin), {
    headers: { "cache-control": "private, no-store" },
  });
}
