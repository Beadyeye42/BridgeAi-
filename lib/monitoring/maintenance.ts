// Each maintenance step owns its transaction. A failed reminder must not stop
// WhatsApp recovery, email delivery or the final operational alert checks.
export async function runMaintenanceSteps(steps: Record<string, () => Promise<unknown>>) {
  const results: Record<string, unknown> = {};
  const failures: string[] = [];
  for (const [name, run] of Object.entries(steps)) {
    try {
      results[name] = await run();
    } catch {
      // Do not put customer data, provider responses or credentials in logs.
      console.error("Production maintenance step failed", { step: name });
      failures.push(name);
      results[name] = { error: "MAINTENANCE_STEP_FAILED" };
    }
  }
  return { ok: failures.length === 0, failures, results };
}
