import "server-only";
import { createHash } from "node:crypto";
import type { AiEscalationLevel, AiTask } from "@/lib/ai/model-router";

export type AiCallTelemetry = {
  model: string;
  task: AiTask;
  providerResponseIdHash: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  latencyMs: number;
  attempts: number;
  escalationLevel: AiEscalationLevel;
  escalationReason: string;
  estimatedCostUsd: number;
};

const pricingPerMillionTokens: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
};

export function estimateAiCostUsd(input: {
  model: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}) {
  const price = pricingPerMillionTokens[input.model];
  if (!price) return 0;
  const cached = Math.min(input.inputTokens ?? 0, input.cachedInputTokens ?? 0);
  const uncached = Math.max(0, (input.inputTokens ?? 0) - cached);
  return (uncached * price.input + cached * price.cachedInput + (input.outputTokens ?? 0) * price.output) / 1_000_000;
}

export function responseTelemetry(input: {
  response: {
    id: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
      output_tokens_details?: { reasoning_tokens?: number };
    } | null;
  };
  model: string;
  task: AiTask;
  latencyMs: number;
  attempts: number;
  escalationLevel: AiEscalationLevel;
  escalationReason: string;
}): AiCallTelemetry {
  const inputTokens = input.response.usage?.input_tokens;
  const cachedInputTokens = input.response.usage?.input_tokens_details?.cached_tokens;
  const outputTokens = input.response.usage?.output_tokens;
  return {
    model: input.model,
    task: input.task,
    providerResponseIdHash: createHash("sha256").update(input.response.id).digest("hex"),
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens: input.response.usage?.output_tokens_details?.reasoning_tokens,
    latencyMs: input.latencyMs,
    attempts: input.attempts,
    escalationLevel: input.escalationLevel,
    escalationReason: input.escalationReason,
    estimatedCostUsd: estimateAiCostUsd({ model: input.model, inputTokens, cachedInputTokens, outputTokens }),
  };
}
