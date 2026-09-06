import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), plan: vi.fn(), subscription: vi.fn(), category: vi.fn(), coverage: vi.fn(),
  checkout: vi.fn(), upsert: vi.fn(), audit: vi.fn(), promotion: vi.fn(), price: vi.fn(),
}));
vi.mock("@/lib/auth/api", () => ({ requireSupplierApi: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: { membershipPlan: { findFirst: mocks.plan }, subscription: { findUnique: mocks.subscription }, supplierProductCategory: { findFirst: mocks.category }, coverageArea: { findMany: mocks.coverage } },
  runAsDatabaseWorker: (_name: string, fn: (tx: unknown) => unknown) => fn({ subscription: { upsert: mocks.upsert }, auditLog: { create: mocks.audit }, membershipPromotion: { findFirst: mocks.promotion } }),
}));
vi.mock("@/lib/config", () => ({ applicationOrigin: () => "https://bridge.example" }));
vi.mock("@/lib/stripe/server", () => ({ getStripe: () => ({ checkout: { sessions: { create: mocks.checkout } } }), ensureMembershipPlanStripePrice: mocks.price, ensureMembershipPromotionStripeCoupon: vi.fn() }));
vi.mock("@/lib/monitoring/operational-alerts", () => ({ runProductionMonitoringSafely: vi.fn() }));
import { POST } from "../app/api/billing/subscription/checkout/route";
const request = () => new Request("https://bridge.example/api/billing/subscription/checkout", { method: "POST", body: JSON.stringify({ membershipPlanId: "plan_hyperlocal_partner", supplierCompanyId: "other-tenant" }) });
const session = (role = "OWNER") => ({ companyId: "own-tenant", session: { userId: "user-a", user: { memberships: [{ supplierCompanyId: "own-tenant", role, supplierCompany: { status: "APPROVED" } }] } } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(session());
  mocks.plan.mockResolvedValue({ id: "plan_hyperlocal_partner", tier: "HYPERLOCAL", code: "bridge-ai-hyperlocal-partner", name: "Hyperlocal Partner", monthlyPricePence: 0, maximumRadiusMiles: 2, taxEnabled: false });
  mocks.subscription.mockResolvedValue({ id: "sub", status: "EXPIRED", providerCustomerId: "cus_existing" });
  mocks.category.mockResolvedValue({ productCategoryId: "eligible" });
  mocks.coverage.mockResolvedValue([{ type: "DISTANCE", radiusMiles: 2 }]);
  mocks.price.mockResolvedValue("price_free");
  mocks.upsert.mockResolvedValue({ id: "sub" });
  mocks.checkout.mockResolvedValue({ url: "https://checkout.stripe.com/test" });
});
describe("free Hyperlocal checkout", () => {
  it("uses zero-price card-optional checkout, no promotions, own tenant and an audit record", async () => {
    expect((await POST(request()))!.status).toBe(200);
    expect(mocks.checkout).toHaveBeenCalledWith(expect.objectContaining({ payment_method_collection: "if_required", allow_promotion_codes: false, line_items: [{ price: "price_free", quantity: 1 }] }), expect.anything());
    expect(mocks.promotion).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { supplierCompanyId: "own-tenant" } }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ supplierCompanyId: "own-tenant", action: "BILLING.MEMBERSHIP_CHECKOUT_CREATED", metadata: expect.objectContaining({ monthlyPricePence: 0 }) }) }));
  });
  it.each([1, 3, 10])("rejects non-fixed coverage of %s miles", async (radiusMiles) => {
    mocks.coverage.mockResolvedValue([{ type: "DISTANCE", radiusMiles }]);
    expect((await POST(request()))!.status).toBe(409);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it("rejects ineligible industries", async () => {
    mocks.category.mockResolvedValue(null);
    expect((await POST(request()))!.status).toBe(409);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it("fails closed before the migration rather than charging the old price", async () => {
    mocks.plan.mockResolvedValue({ tier: "HYPERLOCAL", monthlyPricePence: 1499, maximumRadiusMiles: 10 });
    expect((await POST(request()))!.status).toBe(503);
    expect(mocks.price).not.toHaveBeenCalled();
  });
  it("denies a member and an identity without membership in the authorised company", async () => {
    mocks.auth.mockResolvedValue(session("MEMBER"));
    expect((await POST(request()))!.status).toBe(403);
    mocks.auth.mockResolvedValue({ ...session(), companyId: "other-tenant" });
    expect((await POST(request()))!.status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
