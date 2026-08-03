import { NextResponse } from "next/server";
import { requireSupplierApi } from "@/lib/auth/api";
import { prisma } from "@/lib/db";
import { applicationOrigin } from "@/lib/config";
import { getStripe } from "@/lib/stripe/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const subscription = await prisma.subscription.findUnique({ where: { supplierCompanyId: auth.companyId } });
  if (!subscription?.providerCustomerId) return NextResponse.redirect(new URL("/dashboard/subscription?billing=unavailable", request.url));
  try {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: subscription.providerCustomerId,
      return_url: `${applicationOrigin(request.url)}/dashboard/subscription`,
    });
    return NextResponse.redirect(portal.url, 303);
  } catch (error) {
    console.error("Billing portal failed", error);
    return NextResponse.redirect(new URL("/dashboard/subscription?billing=error", request.url));
  }
}
