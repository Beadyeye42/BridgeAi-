import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AiCallTelemetry } from "@/lib/ai/telemetry";
import { openAiGuardrailConfiguration } from "@/lib/config";
import { writeWhatsAppSystemEvent } from "@/lib/whatsapp/system-events";

export async function recordAiUsageEvents(
  tx: Prisma.TransactionClient,
  events: AiCallTelemetry[],
  context: {
    requestId?: string | null;
    workflowId?: string | null;
    quoteRequestId?: string | null;
  },
) {
  if (!events.length) return;
  await tx.aiUsageEvent.createMany({
    data: events.map((event) => ({
      id: randomUUID(),
      model: event.model,
      task: event.task,
      inputTokens: event.inputTokens,
      cachedInputTokens: event.cachedInputTokens,
      outputTokens: event.outputTokens,
      reasoningTokens: event.reasoningTokens,
      latencyMs: event.latencyMs,
      attempts: event.attempts,
      escalationLevel: event.escalationLevel,
      escalationReason: event.escalationReason,
      providerResponseIdHash: event.providerResponseIdHash,
      requestId: context.requestId ?? null,
      workflowId: context.workflowId ?? null,
      quoteRequestId: context.quoteRequestId ?? null,
      estimatedCostUsd: event.estimatedCostUsd.toFixed(8),
    })),
  });

  const threshold = openAiGuardrailConfiguration().highCostCallAlertUsd;
  for (const event of events.filter((item) => item.estimatedCostUsd >= threshold)) {
    await writeWhatsAppSystemEvent(tx, "whatsapp_ai", {
      severity: "WARNING",
      code: "OPENAI_HIGH_COST_CALL",
      message: "An AI call exceeded the configured estimated-cost threshold.",
      context: {
        model: event.model,
        task: event.task,
        estimatedCostUsd: Number(event.estimatedCostUsd.toFixed(8)),
        escalationLevel: event.escalationLevel,
        escalationReason: event.escalationReason,
        providerResponseIdHash: event.providerResponseIdHash,
      },
    });
  }
}
