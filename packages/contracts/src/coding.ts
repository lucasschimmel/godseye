import { z } from "zod";
import { RepositoryConfiguration } from "./http-domain.js";

export const CODING_RUNNERS = ["codex", "claude-code"] as const;
export const CODING_RUNNER_DEFAULT_COST_MICROS = {
  codex: 500000,
  "claude-code": 100000,
} as const satisfies Readonly<Record<(typeof CODING_RUNNERS)[number], number>>;
export const CODING_TEST_PROFILES = ["none", "typecheck", "test"] as const;
export const CODING_STATES = [
  "queued",
  "running",
  "cancel_requested",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
  "reconciling",
] as const;
export const CODING_DEFAULTS = {
  maxPreparations: 100,
  maxTasks: 100,
  maxInputBytes: 8192,
  maxPatchBytes: 131072,
  maxOutputBytes: 32768,
  timeoutSeconds: 300,
  maxCostMicros: 100000,
} as const;
const Id = z.string().uuid();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Sha = z.string().regex(/^[a-f0-9]{40}$/);
const Revision = z.number().int().nonnegative();
const Moment = z.string().datetime();
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
export const CodingLimits = z
  .object({
    timeoutSeconds: z.number().int().min(5).max(900),
    maxCostMicros: z.number().int().min(1000).max(1000000),
    maxPatchBytes: z.number().int().min(1).max(CODING_DEFAULTS.maxPatchBytes),
    maxOutputBytes: z.number().int().min(1).max(CODING_DEFAULTS.maxOutputBytes),
  })
  .strict();
export const PrepareCodingTask = z
  .object({
    projectId: Id,
    environmentId: Id,
    expectedProjectRevision: Revision,
    expectedEnvironmentRevision: Revision,
    runner: z.enum(CODING_RUNNERS),
    commitSha: Sha,
    input: z
      .string()
      .trim()
      .min(1)
      .max(CODING_DEFAULTS.maxInputBytes)
      .refine(
        (value) => byteLength(value) <= CODING_DEFAULTS.maxInputBytes,
        "Coding input exceeds byte limit",
      ),
    limits: CodingLimits,
    testProfile: z.enum(CODING_TEST_PROFILES),
    previewRequested: z.boolean(),
  })
  .strict();
export type PrepareCodingTaskInput = z.infer<typeof PrepareCodingTask>;
export const CodingPreparation = PrepareCodingTask.extend({
  id: Id,
  repository: RepositoryConfiguration,
  repositoryHash: Hash,
  hash: Hash,
  createdAt: Moment,
}).strict();
export type CodingPreparationView = z.infer<typeof CodingPreparation>;
export const AdmitCodingTask = z.object({ preparationId: Id, expectedHash: Hash }).strict();
export type AdmitCodingTaskInput = z.infer<typeof AdmitCodingTask>;
export const CodingArtifact = z
  .object({
    id: Id,
    kind: z.enum(["patch", "test-log"]),
    sha256: Hash,
    bytes: z.number().int().nonnegative().max(CODING_DEFAULTS.maxPatchBytes),
    content: z.string().max(CODING_DEFAULTS.maxPatchBytes),
  })
  .strict()
  .refine((value) => byteLength(value.content) === value.bytes, "Artifact byte count mismatch");
export const CodingResult = z
  .object({
    taskId: Id,
    worktreeId: Id,
    preparationHash: Hash,
    commitSha: Sha,
    summary: z.string().max(CODING_DEFAULTS.maxOutputBytes),
    patch: CodingArtifact.nullable(),
    tests: z
      .array(
        z
          .object({
            profile: z.enum(CODING_TEST_PROFILES),
            status: z.enum(["not-run", "passed", "failed"]),
            exitCode: z.number().int().min(0).max(255).nullable(),
            log: CodingArtifact.nullable(),
          })
          .strict()
          .refine(
            (value) =>
              value.profile === "none"
                ? value.status === "not-run" && value.exitCode === null && value.log === null
                : value.status === "not-run"
                  ? value.exitCode === null
                  : value.status === "passed"
                    ? value.exitCode === 0
                    : value.exitCode !== null && value.exitCode !== 0,
            "Inconsistent test evidence",
          ),
      )
      .max(1),
    preview: z
      .object({
        state: z.enum(["not-requested", "unavailable"]),
        reason: z.string().max(256).nullable(),
      })
      .strict(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().nullable(),
        outputTokens: z.number().int().nonnegative().nullable(),
        costMicros: z.number().int().nonnegative().nullable(),
        accounting: z.enum(["measured", "reserved-conservatively", "unknown"]),
      })
      .strict(),
  })
  .strict();
export type CodingResultView = z.infer<typeof CodingResult>;
export const CodingTask = z
  .object({
    id: Id,
    preparationId: Id,
    projectId: Id,
    environmentId: Id,
    runId: Id.nullable(),
    runner: z.enum(CODING_RUNNERS),
    state: z.enum(CODING_STATES),
    correlationId: Id,
    submissionIntended: z.boolean(),
    cleanupState: z.enum(["not-started", "pending", "revoked", "stopped", "quarantined"]),
    worktree: z
      .object({
        id: Id,
        baseSha: Sha,
        disposition: z.enum(["planned", "active", "retained", "released", "quarantined"]),
      })
      .strict(),
    reason: z.string().max(160).nullable(),
    createdAt: Moment,
    updatedAt: Moment,
    finishedAt: Moment.nullable(),
  })
  .strict();
export type CodingTaskView = z.infer<typeof CodingTask>;
export const CodingTaskDetail = z
  .object({ task: CodingTask, preparation: CodingPreparation, result: CodingResult.nullable() })
  .strict();
export type CodingTaskDetailView = z.infer<typeof CodingTaskDetail>;
export const CodingCapability = z
  .object({
    runner: z.enum(CODING_RUNNERS),
    available: z.boolean(),
    version: z.string().max(100).nullable(),
    reason: z.string().max(512),
    isolation: z.literal("disposable-kvm"),
    billing: z.enum(["bounded-api", "unavailable"]),
    auth: z.literal("task-scoped-broker"),
  })
  .strict();
export type CodingCapabilityView = z.infer<typeof CodingCapability>;
export const CodingOverview = z
  .object({
    capabilities: z.array(CodingCapability).max(2),
    preparations: z.array(CodingPreparation).max(CODING_DEFAULTS.maxPreparations),
    tasks: z.array(CodingTask).max(CODING_DEFAULTS.maxTasks),
  })
  .strict();
export type CodingOverviewView = z.infer<typeof CodingOverview>;

/** Trusted private seam. Every provider enforces outer KVM and hard cost ceilings independently. */
export interface CodingProviderRequest {
  taskId: string;
  correlationId: string;
  worktreeId: string;
  preparation: CodingPreparationView;
  deadline: string;
}
export interface CodingObservation {
  attempts?: import("./usage.js").AttemptOutcomeInput[];
  state: "succeeded" | "failed" | "cancelled" | "unknown";
  stopped: boolean;
  grantsRevoked: boolean;
  workspace: "retained" | "released" | "quarantined";
  result?: CodingResultView;
  reason?: string;
}
export interface CodingProvider {
  readonly qualified: boolean;
  capabilities(): CodingCapabilityView[];
  /** Independently bind repository identity and exact commit; no project code may execute here. */
  verifySource(
    preparation: CodingPreparationView,
    signal: AbortSignal,
  ): Promise<{ repositoryHash: string; commitSha: string }>;
  /** No paid calls or host project code. Availability must include enforceable cost bounds. */
  preflight(
    preparation: CodingPreparationView,
    signal: AbortSignal,
  ): Promise<CodingQualificationView>;
  submit(
    request: CodingProviderRequest,
    context: {
      signal: AbortSignal;
      assertActive(): Promise<void>;
      attempts?: import("./usage.js").UsageAttemptReporter;
    },
  ): Promise<CodingObservation>;
  /** Read-only: never restart, submit, renew credentials or allocate a workspace. */
  inspect(request: CodingProviderRequest, signal: AbortSignal): Promise<CodingObservation>;
  stop(request: CodingProviderRequest, signal: AbortSignal): Promise<CodingObservation>;
}

export const CodingQualification = z
  .object({
    runner: z.enum(CODING_RUNNERS),
    runnerVersion: z.string().min(1).max(100),
    pinnedRuntimeHash: Hash,
    guestImageHash: Hash,
    isolation: z.literal("disposable-kvm"),
    preparationHash: Hash,
    repositoryHash: Hash,
    commitSha: Sha,
    policyHash: Hash,
    observedAt: Moment,
    expiresAt: Moment,
    resources: z
      .object({
        memoryMiB: z.number().int().min(64).max(65536),
        cpuMilliCores: z.number().int().min(1).max(64000),
        maxProcesses: z.number().int().min(1).max(4096),
        diskMiB: z.number().int().min(1).max(262144),
      })
      .strict(),
    network: z.enum(["broker-only", "none"]),
    billing: z.literal("bounded-api"),
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.expiresAt) > Date.parse(value.observedAt) &&
      Date.parse(value.expiresAt) - Date.parse(value.observedAt) <= 60000,
    "Invalid qualification lifetime",
  );
export type CodingQualificationView = z.infer<typeof CodingQualification>;
