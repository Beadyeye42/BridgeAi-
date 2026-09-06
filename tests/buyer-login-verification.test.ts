import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verifyOtp: vi.fn(), getClaims: vi.fn(), signOut: vi.fn(), complete: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/supabase/auth-server", () => ({ createClient: async () => ({ auth: mocks }) }));
vi.mock("@/lib/buyer/auth", () => ({ completeBuyerLogin: mocks.complete, recordBuyerLoginVerificationFailure: mocks.record }));
import { POST } from "../app/api/buyer/auth/verify/route";

const request = () => new Request("https://bridge-it.example/api/buyer/auth/verify", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ challenge: "challenge-123", tokenHash: "a".repeat(64), type: "magiclink" }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.verifyOtp.mockResolvedValue({ data: { user: { id: "buyer" }, session: { access_token: "verified-token" } }, error: null });
  mocks.getClaims.mockResolvedValue({ data: { claims: { session_id: "session-id" } } });
});

describe("failed Buyer Hub sign-in isolation", () => {
  it("does not revoke an existing session when the link token is invalid", async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ error: new Error("invalid"), data: {} });
    expect((await POST(request())).status).toBe(400);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("revokes only the newly verified session if the independent challenge fails", async () => {
    mocks.complete.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(400);
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });

  it("keeps a successfully verified session", async () => {
    mocks.complete.mockResolvedValueOnce({ requestedPath: "/buyer/orders" });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ next: "/buyer/orders" });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
