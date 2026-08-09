import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { runAsDatabaseWorker } from "@/lib/db";
import { applicationOrigin } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("ref")?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9]{4,24}$/.test(code)) return NextResponse.redirect(new URL("/register", applicationOrigin(request.url)));
  const token = randomBytes(32).toString("hex");
  const affiliate = await runAsDatabaseWorker("affiliate_attribution", (tx) => tx.affiliate.findFirst({ where: { code, status: "ACTIVE" }, select: { id: true } }));
  if (!affiliate) return NextResponse.redirect(new URL("/register", applicationOrigin(request.url)));
  await runAsDatabaseWorker("affiliate_attribution", (tx) => tx.referralClick.create({ data: {
    affiliateId: affiliate.id,
    referralCode: code,
    attributionTokenHash: createHash("sha256").update(token).digest("hex"),
    ipHash: request.headers.get("x-forwarded-for") ? createHash("sha256").update(request.headers.get("x-forwarded-for")!).digest("hex") : null,
    userAgent: request.headers.get("user-agent")?.slice(0, 1000),
    landingPath: url.pathname,
  } }));
  const response = NextResponse.redirect(new URL(`/register?ref=${encodeURIComponent(code)}`, applicationOrigin(request.url)));
  response.cookies.set("bridge_affiliate_ref", `${code}.${token}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return response;
}
