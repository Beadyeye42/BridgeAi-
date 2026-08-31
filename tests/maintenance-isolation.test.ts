import { describe, expect, it, vi } from "vitest";
import { runMaintenanceSteps } from "@/lib/monitoring/maintenance";

describe("production maintenance isolation", () => {
  it("still runs recovery, email and alerts after a maintenance failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const whatsapp = vi.fn().mockResolvedValue(2);
    const email = vi.fn().mockResolvedValue({ sent: 1 });
    const monitoring = vi.fn().mockResolvedValue({ queued: 1 });
    const result = await runMaintenanceSteps({
      membershipExpiry: async () => { throw new Error("private database details"); },
      whatsapp,
      staleCapacityReminders: async () => { throw new Error("42501"); },
      email, monitoring,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(["membershipExpiry", "staleCapacityReminders"]);
    expect(whatsapp).toHaveBeenCalledOnce();
    expect(email).toHaveBeenCalledOnce();
    expect(monitoring).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("private database details");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private database details");
    log.mockRestore();
  });
  it("reports success only when every step succeeds", async () => {
    expect(await runMaintenanceSteps({ monitoring: async () => ({ sent: 0 }) })).toEqual({
      ok: true, failures: [], results: { monitoring: { sent: 0 } },
    });
  });
});
