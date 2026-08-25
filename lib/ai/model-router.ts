import "server-only";
import { openAiConfiguration } from "@/lib/config";

export type AiTask = "QUOTE_INTAKE" | "ATTACHMENT_ANALYSIS" | "ATTACHMENT_ESCALATION";
export type AiComplexity = "SIMPLE" | "MODERATE" | "COMPLEX";
export type AiEscalationLevel = "NONE" | "TERRA";

export type AiRoute = {
  model: string;
  reason: string;
  escalationLevel: AiEscalationLevel;
};

export function initialAiRoute(task: AiTask): AiRoute {
  const config = openAiConfiguration();
  if (config.routingMode === "TERRA_ONLY_TESTING") {
    return { model: config.complexModel, reason: "TERRA_ONLY_TESTING", escalationLevel: "TERRA" };
  }
  return {
    model: config.defaultModel,
    reason: task === "QUOTE_INTAKE" ? "ROUTINE_CONVERSATIONAL_INTAKE" : "LUNA_FIRST_DOCUMENT_REVIEW",
    escalationLevel: "NONE",
  };
}

export function attachmentEscalationRoute(input: {
  complexity: AiComplexity;
  conflictingFacts: boolean;
  requiresComplexReasoning: boolean;
  criticalAmbiguities: string[];
}): AiRoute | null {
  const config = openAiConfiguration();
  if (config.routingMode !== "LUNA_WITH_TERRA_ESCALATION") return null;

  // Missing facts are clarification work, not a reason to buy a larger model.
  const reason = input.conflictingFacts
    ? "CONFLICTING_DOCUMENT_FACTS"
    : input.requiresComplexReasoning && input.complexity === "COMPLEX"
      ? "COMPLEX_DOCUMENT_REASONING"
      : null;
  if (!reason) return null;
  return { model: config.complexModel, reason, escalationLevel: "TERRA" };
}
