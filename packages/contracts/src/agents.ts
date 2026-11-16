import { z } from "zod";
import { AgentTaskToolSelection, AgentToolName, AgentToolPolicy } from "./agents-tools.js";

export const AGENT_ROLES = ["operations", "security", "research-marketing"] as const;
export const AGENT_MODELS = ["gpt-6-luna"] as const;
export const AGENT_STATES = [
  "queued",
  "running",
  "cancel_requested",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
  "reconciling",
] as const;
export const AGENT_DEFAULTS = {
  model: "gpt-6-luna",
  maxOutputTokens: 1024,
  timeoutSeconds: 120,
  maxCostMicros: 10000,
  pollMs: 500,
  maxProfiles: 64,
  maxTasks: 500,
  maxEvents: 100,
  maxInputBytes: 8192,
} as const;
const Id = z.string().uuid();
const Revision = z.number().int().nonnegative();
const Moment = z.string().datetime();
export const AgentLimits = z
  .object({
    maxOutputTokens: z.number().int().min(32).max(2048),
    timeoutSeconds: z.number().int().min(5).max(300),
    maxCostMicros: z.number().int().min(1000).max(100000),
    maxTurns: z.number().int().min(1).max(4),
    maxRequests: z.number().int().min(1).max(4),
  })
  .strict();
export type AgentLimitsInput = z.infer<typeof AgentLimits>;
export const AgentProfileConfiguration = z
  .object({
    model: z.enum(AGENT_MODELS),
    limits: AgentLimits,
    toolPolicy: AgentToolPolicy.nullable().optional(),
  })
  .strict();
function profilePolicy(
  input: { limits: AgentLimitsInput; toolPolicy?: AgentToolPolicy | null },
  context: z.RefinementCtx,
) {
  if (!input.toolPolicy && (input.limits.maxRequests !== 1 || input.limits.maxTurns !== 1))
    context.addIssue({
      code: "custom",
      message: "Model continuation requires an explicit tool policy",
    });
  if (
    input.toolPolicy &&
    (input.limits.maxRequests < 2 ||
      input.limits.maxRequests !== input.limits.maxTurns ||
      input.toolPolicy.timeoutSeconds > input.limits.timeoutSeconds)
  )
    context.addIssue({
      code: "custom",
      message: "Tool policy and model ceilings are inconsistent",
    });
}
export const CreateAgentProfile = AgentProfileConfiguration.extend({
  projectId: Id,
  environmentId: Id,
  role: z.enum(AGENT_ROLES),
  expectedProjectRevision: Revision,
  expectedEnvironmentRevision: Revision,
})
  .strict()
  .superRefine(profilePolicy);
export type CreateAgentProfileInput = z.infer<typeof CreateAgentProfile>;
export const ConfigureAgentProfile = AgentProfileConfiguration.extend({
  expectedRevision: Revision,
  expectedProjectRevision: Revision,
  expectedEnvironmentRevision: Revision,
}).strict();
export type ConfigureAgentProfileInput = z.infer<typeof ConfigureAgentProfile>;
export const ChangeAgentProfile = z.object({ expectedRevision: Revision }).strict();
export const AgentProfile = z
  .object({
    id: Id,
    projectId: Id,
    environmentId: Id,
    role: z.enum(AGENT_ROLES),
    model: z.enum(AGENT_MODELS),
    limits: AgentLimits,
    toolPolicy: AgentToolPolicy.optional(),
    revision: Revision,
    projectRevision: Revision,
    environmentRevision: Revision,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    paused: z.boolean(),
    busy: z.boolean(),
    activeTaskId: Id.nullable(),
    skill: z
      .object({
        id: z.literal("godseye-context"),
        version: z.literal("1.0.0"),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    runtime: z.enum(["unconfigured", "available"]),
    tools: z.array(AgentToolName).max(5),
    createdAt: Moment,
    updatedAt: Moment,
  })
  .strict();
export type AgentProfileView = z.infer<typeof AgentProfile>;
export const LaunchAgentTask = z
  .object({
    profileId: Id,
    expectedRevision: Revision,
    input: z.string().trim().min(1).max(8192),
    toolGrant: AgentTaskToolSelection.optional(),
  })
  .strict();
export type LaunchAgentTaskInput = z.infer<typeof LaunchAgentTask>;
export const AgentTask = z
  .object({
    id: Id,
    profileId: Id,
    projectId: Id,
    environmentId: Id,
    profileRevision: Revision,
    toolGrant: AgentTaskToolSelection.optional(),
    runId: Id.nullable(),
    state: z.enum(AGENT_STATES),
    providerRunId: z.string().max(128).nullable(),
    input: z.string().max(8192),
    output: z.string().max(32768).nullable(),
    reason: z.string().max(160).nullable(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().nullable(),
        outputTokens: z.number().int().nonnegative().nullable(),
        costState: z.literal("reserved-conservatively"),
      })
      .strict(),
    createdAt: Moment,
    updatedAt: Moment,
    finishedAt: Moment.nullable(),
  })
  .strict();
export type AgentTaskView = z.infer<typeof AgentTask>;
export const AgentEvent = z
  .object({
    id: Id,
    taskId: Id,
    sequence: z.number().int().positive(),
    state: z.enum(AGENT_STATES),
    occurredAt: Moment,
  })
  .strict();
export const AgentTaskDetail = z
  .object({ task: AgentTask, events: z.array(AgentEvent).max(100) })
  .strict();
export type AgentTaskDetailView = z.infer<typeof AgentTaskDetail>;
export const AgentTaskAction = z.object({ expectedRevision: Revision.optional() }).strict();
export const AgentOverview = z
  .object({
    status: z.enum(["unconfigured", "available"]),
    message: z.string().max(512),
    profiles: z.array(AgentProfile).max(64),
    tasks: z.array(AgentTask).max(100),
    roles: z.array(z.enum(AGENT_ROLES)),
    models: z.array(z.enum(AGENT_MODELS)),
    defaults: AgentLimits,
    tools: z.array(AgentToolName).max(5),
  })
  .strict();
export type AgentOverviewView = z.infer<typeof AgentOverview>;
