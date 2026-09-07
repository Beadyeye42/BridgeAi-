import { NextResponse } from "next/server";
import { requireSupplierApi } from "@/lib/auth/api";
import { prisma } from "@/lib/db";
import { applicationOrigin } from "@/lib/config";
import { getStripe } from "@/lib/stripe/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;
  const membership = auth.session.user.memberships.find((item) => item.supplierCompanyId === auth.companyId);
  if (!membership || !["OWNER", "MANAGER"].includes(membership.role)) {
    return NextResponse.json({ error: "Owner or manager access required" }, { status: 403 });
  }
  const subscription = await prisma.subscription.findUnique({ where: { supplierCompanyId: auth.companyId } });
  if (!subscription?.providerCustomerId) return NextResponse.redirect(new URL("/dashboard/subscription?billing=unavailable", request.url));
  try {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: subscription.providerCustomerId,
      return_url: `${applicationOrigin(request.url)}/dashboard/subscription`,
    });
    await prisma.auditLog.create({ data: {
      actorUserId: auth.session.userId, supplierCompanyId: auth.companyId,
      action: "BILLING.PORTAL_SESSION_CREATED", entityType: "Subscription", entityId: subscription.id,
      summary: "Authorised supplier billing portal session created",
    } });
    const response = NextResponse.redirect(portal.url, 303);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    console.error("Billing portal failed", error);
    return NextResponse.redirect(new URL("/dashboard/subscription?billing=error", request.url));
  }
}
