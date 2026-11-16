import { z } from "zod";

const Id = z.string().uuid();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Revision = z.number().int().nonnegative();
const Text = z
  .string()
  .trim()
  .min(1)
  .max(8192)
  .refine((v) => new TextEncoder().encode(v).byteLength <= 8192, "Text exceeds byte limit");
export const ORCHESTRATION_DEFAULTS = {
  maxSteps: 12,
  maxPlans: 100,
  maxBytes: 65536,
  schedulerMs: 1000,
  maxLifetimeSeconds: 3600,
} as const;
const Base = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  dependsOn: z.array(z.string().max(48)).max(12),
});
export const OrchestrationStep = z.discriminatedUnion("kind", [
  Base.extend({
    kind: z.literal("hermes"),
    profileId: Id,
    expectedRevision: Revision,
    input: Text,
    includeDependencyOutputs: z.boolean().optional(),
  }).strict(),
  Base.extend({ kind: z.literal("coding"), preparationId: Id, expectedHash: Hash }).strict(),
  Base.extend({
    kind: z.literal("clarification"),
    question: Text,
    answer: Text.optional(),
  }).strict(),
]);
export type OrchestrationStepInput = z.infer<typeof OrchestrationStep>;
export const PrepareOrchestration = z
  .object({
    projectId: Id,
    environmentId: Id,
    expectedProjectRevision: Revision,
    expectedEnvironmentRevision: Revision,
    title: z.string().trim().min(1).max(120),
    maxCostMicros: z.number().int().nonnegative().max(12000000),
    lifetimeSeconds: z.number().int().min(30).max(3600),
    steps: z.array(OrchestrationStep).min(1).max(12),
  })
  .strict()
  .superRefine((v, ctx) => {
    const byId = new Map(v.steps.map((s) => [s.id, s]));
    const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
    if (byId.size !== v.steps.length) invalid("Duplicate step identifiers");
    for (const s of v.steps)
      if (new Set(s.dependsOn).size !== s.dependsOn.length || s.dependsOn.some((d) => !byId.has(d)))
        invalid("Invalid dependency");
    const visiting = new Set<string>(),
      visited = new Set<string>();
    const walk = (id: string): boolean => {
      if (visiting.has(id)) return false;
      if (visited.has(id)) return true;
      visiting.add(id);
      for (const dep of byId.get(id)?.dependsOn ?? []) if (!walk(dep)) return false;
      visiting.delete(id);
      visited.add(id);
      return true;
    };
    if (v.steps.some((s) => !walk(s.id))) invalid("Cyclic plan");
    if (new TextEncoder().encode(JSON.stringify(v)).byteLength > ORCHESTRATION_DEFAULTS.maxBytes)
      invalid("Plan exceeds byte limit");
  });
export type PrepareOrchestrationInput = z.infer<typeof PrepareOrchestration>;
export const FrozenOrchestrationStep = z
  .object({
    step: OrchestrationStep,
    bindingHash: Hash.nullable(),
    maxCostMicros: z.number().int().nonnegative(),
    timeoutSeconds: z.number().int().nonnegative(),
  })
  .strict();
export const OrchestrationPlan = z
  .object({
    id: Id,
    projectId: Id,
    environmentId: Id,
    expectedProjectRevision: Revision,
    expectedEnvironmentRevision: Revision,
    title: z.string().max(120),
    epoch: z.number().int().positive(),
    maxCostMicros: z.number().int().nonnegative(),
    steps: z.array(FrozenOrchestrationStep).min(1).max(12),
    hash: Hash,
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    sourceTaskId: Id.nullable(),
    supersedesId: Id.nullable(),
  })
  .strict();
export type OrchestrationPlanView = z.infer<typeof OrchestrationPlan>;
export const ORCHESTRATION_STATES = [
  "pending",
  "approved",
  "running",
  "waiting_clarification",
  "succeeded",
  "failed",
  "unknown",
  "cancel_requested",
  "cancelled",
  "rejected",
  "expired",
] as const;
export const OrchestrationChild = z
  .object({
    stepId: z.string().max(48),
    taskId: Id.nullable(),
    kind: z.enum(["hermes", "coding", "clarification"]),
    state: z.enum([
      "pending",
      "intended",
      "running",
      "succeeded",
      "failed",
      "unknown",
      "cancelled",
      "waiting_clarification",
    ]),
    reason: z.string().max(160).nullable(),
  })
  .strict();
export type OrchestrationChildView = z.infer<typeof OrchestrationChild>;
export const OrchestrationDetail = z
  .object({
    plan: OrchestrationPlan,
    state: z.enum(ORCHESTRATION_STATES),
    children: z.array(OrchestrationChild).max(12),
    approvedAt: z.string().datetime().nullable(),
    approvedBy: z.string().max(128).nullable(),
    reason: z.string().max(160).nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type OrchestrationDetailView = z.infer<typeof OrchestrationDetail>;
export const OrchestrationOverview = z
  .object({ plans: z.array(OrchestrationDetail).max(100) })
  .strict();
export type OrchestrationOverviewView = z.infer<typeof OrchestrationOverview>;
export const DecideOrchestration = z.object({ expectedHash: Hash }).strict();
export const AnswerOrchestration = z
  .object({ expectedHash: Hash, stepId: z.string().max(48), answer: Text })
  .strict();
export type AnswerOrchestrationInput = z.infer<typeof AnswerOrchestration>;
export const ProposeOrchestration = z.object({ taskId: Id }).strict();
