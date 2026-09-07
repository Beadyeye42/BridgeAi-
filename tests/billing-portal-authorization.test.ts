import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), subscription: vi.fn(), portal: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/api", () => ({ requireSupplierApi: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { subscription: { findUnique: mocks.subscription }, auditLog: { create: mocks.audit } } }));
vi.mock("@/lib/config", () => ({ applicationOrigin: () => "https://bridge.test" }));
vi.mock("@/lib/stripe/server", () => ({ getStripe: () => ({ billingPortal: { sessions: { create: mocks.portal } } }) }));
import { GET } from "@/app/api/billing/portal/route";
function auth(role: string, company = "company") {
  mocks.auth.mockResolvedValue({ companyId: "company", session: { userId: "user", user: { memberships: [{ supplierCompanyId: company, role }] } } });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.subscription.mockResolvedValue({ id: "sub", providerCustomerId: "cus_verified" });
  mocks.portal.mockResolvedValue({ url: "https://billing.stripe.com/test" });
});
describe("supplier billing portal", () => {
  it("denies ordinary team members before creating a privileged Stripe session", async () => {
    auth("MEMBER");
    expect((await GET(new Request("https://bridge.test/api/billing/portal")))?.status).toBe(403);
    expect(mocks.portal).not.toHaveBeenCalled();
    expect(mocks.subscription).not.toHaveBeenCalled();
  });
  it("does not accept manager authority from another company", async () => {
    auth("MANAGER", "other-company");
    expect((await GET(new Request("https://bridge.test/api/billing/portal")))?.status).toBe(403);
    expect(mocks.portal).not.toHaveBeenCalled();
  });
  it.each(["OWNER", "MANAGER"])("allows and audits a verified %s", async (role) => {
    auth(role);
    const response = await GET(new Request("https://bridge.test/api/billing/portal"));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.portal).toHaveBeenCalledWith({ customer: "cus_verified", return_url: "https://bridge.test/dashboard/subscription" });
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: "user", supplierCompanyId: "company", action: "BILLING.PORTAL_SESSION_CREATED" }) });
  });
});
