import { afterEach, describe, expect, it } from "vitest";
import { attachmentEscalationRoute, initialAiRoute } from "@/lib/ai/model-router";
import { estimateAiCostUsd, responseTelemetry } from "@/lib/ai/telemetry";

const original = {
  apiKey: process.env.OPENAI_API_KEY,
  defaultModel: process.env.OPENAI_DEFAULT_MODEL,
  complexModel: process.env.OPENAI_COMPLEX_MODEL,
  routingMode: process.env.OPENAI_ROUTING_MODE,
};

function configure(mode = "LUNA_WITH_TERRA_ESCALATION") {
  process.env.OPENAI_API_KEY = "test-server-key";
  process.env.OPENAI_DEFAULT_MODEL = "gpt-5.6-luna";
  process.env.OPENAI_COMPLEX_MODEL = "gpt-5.6-terra";
  process.env.OPENAI_ROUTING_MODE = mode;
}

afterEach(() => {
  for (const [name, value] of [
    ["OPENAI_API_KEY", original.apiKey],
    ["OPENAI_DEFAULT_MODEL", original.defaultModel],
    ["OPENAI_COMPLEX_MODEL", original.complexModel],
    ["OPENAI_ROUTING_MODE", original.routingMode],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("Luna-first model routing", () => {
  it.each([
    ["simple photo", "SIMPLE", false, false, [], false],
    ["straightforward PDF", "MODERATE", false, false, [], false],
    ["vague or poor-quality input", "COMPLEX", false, false, ["dimensions"], false],
    ["complex drawing", "COMPLEX", false, true, [], true],
    ["conflicting specification", "MODERATE", true, false, [], true],
  ] as const)("routes %s deterministically", (_name, complexity, conflictingFacts, requiresComplexReasoning, criticalAmbiguities, escalates) => {
    configure();
    expect(initialAiRoute("ATTACHMENT_ANALYSIS")).toMatchObject({
      model: "gpt-5.6-luna",
      escalationLevel: "NONE",
    });
    const route = attachmentEscalationRoute({
      complexity,
      conflictingFacts,
      requiresComplexReasoning,
      criticalAmbiguities: [...criticalAmbiguities],
    });
    expect(Boolean(route)).toBe(escalates);
    if (escalates) expect(route).toMatchObject({ model: "gpt-5.6-terra", escalationLevel: "TERRA" });
  });

  it("prevents Terra escalation in Luna-only mode", () => {
    configure("LUNA_ONLY");
    expect(attachmentEscalationRoute({
      complexity: "COMPLEX",
      conflictingFacts: true,
      requiresComplexReasoning: true,
      criticalAmbiguities: [],
    })).toBeNull();
  });

  it("supports explicit Terra-only testing without changing production defaults", () => {
    configure("TERRA_ONLY_TESTING");
    expect(initialAiRoute("QUOTE_INTAKE")).toMatchObject({
      model: "gpt-5.6-terra",
      reason: "TERRA_ONLY_TESTING",
    });
  });
});

describe("AI cost telemetry", () => {
  it("uses model-specific pricing and hashes provider identifiers", () => {
    expect(estimateAiCostUsd({ model: "gpt-5.6-luna", inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(1.4);
    expect(estimateAiCostUsd({ model: "gpt-5.6-terra", inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(14);
    const telemetry = responseTelemetry({
      response: { id: "resp_sensitive_identifier", usage: { input_tokens: 100, output_tokens: 20 } },
      model: "gpt-5.6-luna",
      task: "QUOTE_INTAKE",
      latencyMs: 42,
      attempts: 1,
      escalationLevel: "NONE",
      escalationReason: "ROUTINE_CONVERSATIONAL_INTAKE",
    });
    expect(telemetry.providerResponseIdHash).not.toContain("resp_sensitive_identifier");
    expect(telemetry.model).toBe("gpt-5.6-luna");
  });
});
