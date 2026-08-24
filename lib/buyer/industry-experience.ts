import { z } from "zod";

export const buyerOrderStateSchema = z.enum(["SELECTED", "ACTIVE", "COMPLETED", "CANCELLED", "ISSUE_REPORTED"]);

const keySchema = z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/, "Use a lowercase key with underscores");

export const buyerDetailFieldSchema = z.object({
  key: keySchema,
  label: z.string().trim().min(1).max(80),
  type: z.enum(["text", "number", "date", "boolean"]).default("text"),
  source: z.enum(["qualification", "request"]).default("qualification"),
}).strict();

export const buyerLifecycleStageSchema = z.object({
  key: keySchema,
  label: z.string().trim().min(1).max(80),
  state: buyerOrderStateSchema,
  description: z.string().trim().max(240).optional(),
  nextAction: z.string().trim().max(240).optional(),
  allowedNext: z.array(keySchema).max(12).default([]),
}).strict();

export const buyerExperienceSchema = z.object({
  version: z.literal(1),
  labels: z.object({
    requestSingular: z.string().trim().min(1).max(40),
    requestPlural: z.string().trim().min(1).max(40),
    orderSingular: z.string().trim().min(1).max(40),
    orderPlural: z.string().trim().min(1).max(40),
    location: z.string().trim().min(1).max(60),
    requiredBy: z.string().trim().min(1).max(60),
    items: z.string().trim().min(1).max(60),
    files: z.string().trim().min(1).max(60),
    quote: z.string().trim().min(1).max(60),
    quotePlural: z.string().trim().min(1).max(60),
  }).strict(),
  detailFields: z.array(buyerDetailFieldSchema).max(30),
  stages: z.array(buyerLifecycleStageSchema).min(1).max(30),
}).superRefine((config, context) => {
  const keys = new Set(config.stages.map((stage) => stage.key));
  if (keys.size !== config.stages.length) context.addIssue({ code: "custom", path: ["stages"], message: "Lifecycle stage keys must be unique" });
  if (!config.stages.some((stage) => stage.state === "SELECTED")) context.addIssue({ code: "custom", path: ["stages"], message: "Add a selected stage" });
  if (!config.stages.some((stage) => stage.state === "COMPLETED")) context.addIssue({ code: "custom", path: ["stages"], message: "Add a completed stage" });
  for (const [index, stage] of config.stages.entries()) {
    for (const target of stage.allowedNext) if (!keys.has(target)) context.addIssue({ code: "custom", path: ["stages", index, "allowedNext"], message: `Unknown target stage: ${target}` });
  }
});

export type BuyerExperience = z.infer<typeof buyerExperienceSchema>;
export type BuyerLifecycleStage = z.infer<typeof buyerLifecycleStageSchema>;

export const defaultBuyerExperience: BuyerExperience = {
  version: 1,
  labels: {
    requestSingular: "request",
    requestPlural: "requests",
    orderSingular: "arrangement",
    orderPlural: "arrangements",
    location: "Location",
    requiredBy: "Required by",
    items: "Requirements",
    files: "Files",
    quote: "Quote",
    quotePlural: "Quotes",
  },
  detailFields: [],
  stages: [
    { key: "selected", label: "Supplier selected", state: "SELECTED", nextAction: "Contact the buyer and agree the final arrangements.", allowedNext: ["confirmed", "cancelled"] },
    { key: "confirmed", label: "Arrangements confirmed", state: "ACTIVE", nextAction: "Complete the agreed supply, hire, manufacture, delivery or service.", allowedNext: ["completed", "cancelled"] },
    { key: "completed", label: "Completed", state: "COMPLETED", allowedNext: [] },
    { key: "cancelled", label: "Did not proceed", state: "CANCELLED", allowedNext: [] },
    { key: "issue_reported", label: "Issue reported", state: "ISSUE_REPORTED", allowedNext: ["confirmed", "cancelled"] },
  ],
};

type ConfiguredCategory = {
  buyerExperienceConfig?: unknown;
  parent?: { buyerExperienceConfig?: unknown } | null;
};

export function resolveBuyerExperience(category: ConfiguredCategory): BuyerExperience {
  const configured = category.parent?.buyerExperienceConfig ?? category.buyerExperienceConfig;
  const parsed = buyerExperienceSchema.safeParse(configured);
  return parsed.success ? parsed.data : defaultBuyerExperience;
}

export function lifecycleStage(experience: BuyerExperience, stageKey: string): BuyerLifecycleStage {
  return experience.stages.find((stage) => stage.key === stageKey)
    ?? { key: stageKey, label: humaniseKey(stageKey), state: "ACTIVE", allowedNext: [] };
}

export function initialLifecycleStage(experience: BuyerExperience) {
  return experience.stages.find((stage) => stage.state === "SELECTED") ?? defaultBuyerExperience.stages[0];
}

export function allowedLifecycleTransitions(experience: BuyerExperience, stageKey: string) {
  const current = lifecycleStage(experience, stageKey);
  return current.allowedNext.map((key) => experience.stages.find((stage) => stage.key === key)).filter((stage): stage is BuyerLifecycleStage => Boolean(stage));
}

export function humaniseKey(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export function configuredRequestDetails(
  experience: BuyerExperience,
  request: Record<string, unknown> & { qualificationData?: unknown },
) {
  const qualification = request.qualificationData && typeof request.qualificationData === "object" && !Array.isArray(request.qualificationData)
    ? request.qualificationData as Record<string, unknown>
    : {};
  return experience.detailFields.flatMap((field) => {
    const value = field.source === "request" ? request[field.key] : qualification[field.key];
    if (value === null || value === undefined || value === "") return [];
    return [{ key: field.key, label: field.label, value: formatConfiguredValue(value, field.type) }];
  });
}

function formatConfiguredValue(value: unknown, type: "text" | "number" | "date" | "boolean") {
  if (type === "boolean") return value === true ? "Yes" : value === false ? "No" : String(value);
  if (type === "date") {
    const date = value instanceof Date ? value : new Date(String(value));
    if (!Number.isNaN(date.valueOf())) return date.toLocaleDateString("en-GB");
  }
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
