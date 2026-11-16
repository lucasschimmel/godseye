import { z } from "zod";
import { AgentToolName } from "./agents-tools.js";

const Id = z.string().uuid();
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Ref = { configurationRef: Id };
export const ActionCommand = z.union([
  z
    .object({
      kind: z.literal("coding.run"),
      taskId: Id,
      preparationId: Id,
      preparationHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("delivery.lifecycle"),
      intent: z.enum(["build", "release", "rollback", "cleanup"]),
      manifestRef: Id,
      manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("database.recovery"),
      intent: z.enum(["full", "diff", "restore", "check"]),
      manifestRef: Id,
      manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("database.lifecycle"),
      intent: z.enum(["provision", "suspend", "resume"]),
      manifestRef: Id,
      manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("project.lifecycle"),
      intent: z.enum(["provision", "suspend", "resume", "export", "quarantine", "purge"]),
      manifestRef: Id,
    })
    .strict(),
  z
    .object({
      kind: z.literal("cell.lifecycle"),
      intent: z.enum(["provision", "stop", "start", "quarantine", "purge"]),
      manifestRef: Id,
      manifestHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("deployment.release"),
      intent: z.enum(["deploy", "restart", "rollback"]),
      artifactDigest: Digest,
      ...Ref,
    })
    .strict(),
  z
    .object({
      kind: z.literal("database.operation"),
      intent: z.enum(["migrate", "rotate", "backup", "restore", "export"]),
      planRef: Id,
    })
    .strict(),
  z
    .object({
      kind: z.literal("job.operation"),
      intent: z.enum(["configure", "trigger", "pause", "resume", "cancel"]),
      definitionRef: Id,
    })
    .strict(),
  z
    .object({
      kind: z.literal("agent.run"),
      profileId: Id,
      skillVersionId: Id,
      inputRef: Id,
      grantRef: Id,
    })
    .strict(),
  z.object({ kind: z.literal("agent.cancel"), runId: Id }).strict(),
  z.object({ kind: z.literal("skill.promote"), skillVersionId: Id }).strict(),
  z
    .object({
      kind: z.literal("approval.resolve"),
      approvalId: Id,
      decision: z.enum(["approve", "reject"]),
    })
    .strict(),
  z
    .object({ kind: z.enum(["domain.configure", "storage.configure", "settings.update"]), ...Ref })
    .strict(),
  z
    .object({ kind: z.literal("personal.lifecycle"), intent: z.enum(["start", "stop", "restart"]) })
    .strict(),
  z
    .object({
      kind: z.literal("incident.update"),
      intent: z.enum(["acknowledge", "mute", "unmute"]),
      expiresAt: z.string().datetime().nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("publication.publish"), artifactId: Id, integrationId: Id }).strict(),
]);
export type ActionCommandInput = z.infer<typeof ActionCommand>;
export const RESOURCE_KINDS = [
  "configuration",
  "manifest",
  "database-plan",
  "job-definition",
  "profile",
  "skill-version",
  "input",
  "run",
  "artifact",
  "integration",
  "grant",
  "approval",
] as const;
export const RegisterResource = z
  .object({
    projectId: Id,
    environmentId: Id,
    kind: z.enum(RESOURCE_KINDS),
    name: z.string().trim().min(1).max(100),
  })
  .strict();
export type RegisterResourceInput = z.infer<typeof RegisterResource>;
export const CreateExecutionPlan = z
  .object({
    projectId: Id,
    environmentId: Id,
    targetId: Id,
    expectedRevision: z.number().int().nonnegative(),
    adapterId: z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/),
    command: ActionCommand,
    maxCostMicros: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    tools: z.array(z.union([z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/), AgentToolName])).max(32),
    destinations: z.array(z.string().regex(/^[a-z0-9][a-z0-9.-]{0,252}$/)).max(32),
  })
  .strict();
export type CreateExecutionPlanInput = z.infer<typeof CreateExecutionPlan>;
export const EffectOutcome = z
  .object({
    status: z.enum(["succeeded", "failed", "unknown"]),
    evidenceRef: z.string().trim().min(1).max(256).optional(),
    costMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type EffectOutcomeInput = z.infer<typeof EffectOutcome>;
export const FOUNDATION_DEFAULTS = {
  leaseMs: 60_000,
  heartbeatMs: 15_000,
  reconcileMs: 30_000,
  approvalMs: 300_000,
  idempotencyRetentionMs: 7 * 86_400_000,
  restoreWindowMs: 30 * 86_400_000,
  auditPageSize: 100,
} as const;
export interface ExecutionContext {
  runId: string;
  planId: string;
  projectId: string;
  environmentId: string;
  epoch: number;
  fence: number;
  effectKey: string;
  command: ActionCommandInput;
  grantId: string;
  workerId: string;
}
export interface ExecutionAdapter {
  id: string;
  qualified: boolean;
  execute(context: ExecutionContext): Promise<EffectOutcomeInput>;
  reconcile(context: ExecutionContext): Promise<EffectOutcomeInput>;
  onFenced?(context: ExecutionContext): Promise<void>;
}
export interface AuditAnchor {
  sequence: number;
  hash: string;
}
export interface AuditExportEntry {
  id: string;
  sequence: number;
  actorId: string;
  projectId: string | null;
  action: string;
  summary: string;
  previousHash: string;
  hash: string;
  occurredAt: string;
}
export interface AuditExportPage {
  from: number;
  to: number;
  previousHash: string;
  entries: AuditExportEntry[];
  anchor: AuditAnchor;
}
