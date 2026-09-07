import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ attachment: vi.fn(), company: vi.fn(), audit: vi.fn(), signed: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "user", user: { role: "SUPPLIER" } }), getPrimarySupplierCompanyId: () => "company" }));
vi.mock("@/lib/buyer/session", () => ({ getBuyerSession: async () => null }));
vi.mock("@/lib/db", () => ({ prisma: { attachment: { findUnique: mocks.attachment }, supplierCompany: { findUnique: mocks.company }, auditLog: { create: mocks.audit } }, runAsDatabaseWorker: vi.fn() }));
vi.mock("@/lib/storage", () => ({ PRIVATE_BUCKET: "private" }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({ storage: { from: () => ({ createSignedUrl: mocks.signed }) } }) }));
vi.mock("@/lib/monitoring/operational-alerts", () => ({ runProductionMonitoringSafely: vi.fn() }));
import { GET } from "@/app/api/attachments/[id]/download/route";
const request = () => GET(new Request("https://bridge.test/api/attachments/file/download"), { params: Promise.resolve({ id: "file" }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.company.mockResolvedValue({ id: "company" });
  mocks.attachment.mockResolvedValue({ id: "file", supplierCompanyId: "company", scanStatus: "CLEAN", storageKey: "companies/company/accreditations/file.pdf", fileName: "file.pdf", mimeType: "application/pdf", quotation: null, quoteRequest: null });
  mocks.signed.mockResolvedValue({ data: { signedUrl: "https://storage.example/signed" }, error: null });
});
describe("company-owned evidence downloads", () => {
  it("allows a clean company-owned file and audits the read", async () => {
    const response = await request();
    expect(response.status).toBe(307);
    expect(mocks.signed).toHaveBeenCalledWith("companies/company/accreditations/file.pdf", 300, { download: "file.pdf" });
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ supplierCompanyId: "company", action: "ATTACHMENT.PRIVILEGED_READ" }) });
  });
  it("denies another company's evidence even if a data-layer regression returns it", async () => {
    mocks.attachment.mockResolvedValue({ id: "file", supplierCompanyId: "other-company", scanStatus: "CLEAN", quotation: null, quoteRequest: null });
    expect((await request()).status).toBe(404);
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it.each(["PENDING", "REJECTED"])("never signs a %s company file", async (scanStatus) => {
    mocks.attachment.mockResolvedValue({ id: "file", supplierCompanyId: "company", scanStatus });
    expect((await request()).status).toBe(423);
    expect(mocks.signed).not.toHaveBeenCalled();
  });
});
