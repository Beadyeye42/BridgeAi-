import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  plan: vi.fn(), current: vi.fn(), activate: vi.fn(), getStripe: vi.fn(), price: vi.fn(),
  promotion: vi.fn(), upsert: vi.fn(), audit: vi.fn(), checkout: vi.fn(),
}));
vi.mock("@/lib/auth/api", () => ({ requireSupplierApi: async () => ({ companyId: "company", session: {
  userId: "verified-user", user: { memberships: [{ supplierCompanyId: "company", role: "OWNER", supplierCompany: { status: "APPROVED" } }] },
} }) }));
vi.mock("@/lib/billing/free-hyperlocal", () => ({ activateFreeHyperlocal: mocks.activate }));
vi.mock("@/lib/db", () => ({
  prisma: {
    membershipPlan: { findFirst: mocks.plan }, subscription: { findUnique: mocks.current },
    supplierProductCategory: { findFirst: async () => ({ productCategoryId: "product" }) },
    coverageArea: { findMany: async () => [{ type: "DISTANCE", radiusMiles: 2 }] },
  },
  runAsDatabaseWorker: async (_role: string, work: (tx: unknown) => unknown) => work({
    membershipPromotion: { findFirst: mocks.promotion }, subscription: { upsert: mocks.upsert }, auditLog: { create: mocks.audit },
  }),
}));
vi.mock("@/lib/stripe/server", () => ({ getStripe: mocks.getStripe, ensureMembershipPlanStripePrice: mocks.price, ensureMembershipPromotionStripeCoupon: vi.fn() }));
vi.mock("@/lib/monitoring/operational-alerts", () => ({ runProductionMonitoringSafely: vi.fn() }));
import { POST } from "@/app/api/billing/subscription/checkout/route";

const request = (id: string) => new Request("https://bridge-it.example/api/billing/subscription/checkout", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ membershipPlanId: id }),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.current.mockResolvedValue(null);
  mocks.promotion.mockResolvedValue(null);
  mocks.upsert.mockResolvedValue({ id: "subscription" });
  mocks.price.mockResolvedValue("price_paid");
  mocks.checkout.mockResolvedValue({ url: "https://checkout.stripe.com/test" });
  mocks.getStripe.mockReturnValue({ checkout: { sessions: { create: mocks.checkout } } });
});

describe("free-to-paid checkout boundary", () => {
  it("activates free membership without contacting Stripe or asking for a card", async () => {
    mocks.plan.mockResolvedValue({ id: "plan_free_hyperlocal", tier: "HYPERLOCAL", maximumRadiusMiles: 2 });
    const response = await POST(request("plan_free_hyperlocal"));
    if (!response) throw new Error("Checkout returned no response");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://bridge-it.example/dashboard/subscription?free=active" });
    expect(mocks.activate).toHaveBeenCalledWith("company", "verified-user");
    expect(mocks.getStripe).not.toHaveBeenCalled();
    expect(mocks.price).not.toHaveBeenCalled();
  });

  it("preserves the free entitlement while paid checkout is incomplete", async () => {
    mocks.plan.mockResolvedValue({ id: "plan_hyperlocal_partner", code: "paid-hyperlocal", name: "Hyperlocal Partner", tier: "HYPERLOCAL", maximumRadiusMiles: 10, monthlyPricePence: 1499, taxEnabled: false });
    mocks.current.mockResolvedValue({ id: "subscription", accessSource: "FREE", status: "ACTIVE", providerCustomerId: "cus_existing", membershipPlanId: "plan_free_hyperlocal" });
    const response = await POST(request("plan_hyperlocal_partner"));
    if (!response) throw new Error("Checkout returned no response");
    expect(response.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { providerCustomerId: "cus_existing" } }));
    expect(mocks.checkout).toHaveBeenCalledWith(expect.objectContaining({ mode: "subscription", metadata: expect.objectContaining({ membershipPlanId: "plan_hyperlocal_partner" }) }), expect.anything());
    expect(mocks.activate).not.toHaveBeenCalled();
  });
});
