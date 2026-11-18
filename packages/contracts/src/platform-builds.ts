import { z } from "zod";

const Moment = z.string().datetime();

/** Jenkins jobs that build the platform itself; the candidate job takes a BRANCH parameter. */
export const PLATFORM_BUILD_JOBS = ["godseye-platform", "godseye-platform-candidate"] as const;
/** Recent builds reported per job. */
export const PLATFORM_BUILD_LIMIT = 8;
export const PLATFORM_BUILD_RESULTS = [
  "SUCCESS",
  "FAILURE",
  "UNSTABLE",
  "ABORTED",
  "NOT_BUILT",
] as const;
/** Why the platform builds cannot be read. Absence of evidence is never shown as an empty history. */
export const PLATFORM_BUILD_UNAVAILABLE_REASONS = [
  "UNREACHABLE",
  "TIMEOUT",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "INVALID",
  "ERROR",
] as const;
export const PLATFORM_BUILD_NOT_CONNECTED_REASONS = ["LOCAL_MODE", "NOT_CONFIGURED"] as const;

export const PlatformBuild = z.object({
  number: z.number().int().positive(),
  /** Null while the build is still running. */
  result: z.enum(PLATFORM_BUILD_RESULTS).nullable(),
  building: z.boolean(),
  startedAt: Moment,
  /** Null while the build is still running. */
  durationMs: z.number().int().nonnegative().nullable(),
  /** Value of the BRANCH build parameter; null when the job does not take one. */
  branch: z.string().min(1).max(200).nullable(),
  /** Commit Jenkins reports as built (git plugin revision); null when it does not say. */
  commitSha: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  url: z.string().url().max(512),
});

const Job = z.object({ name: z.string().min(1).max(100) });
export const PlatformBuildJob = z.discriminatedUnion("state", [
  Job.extend({
    state: z.literal("observed"),
    builds: z.array(PlatformBuild).max(PLATFORM_BUILD_LIMIT),
  }),
  Job.extend({
    state: z.literal("unavailable"),
    reason: z.enum(PLATFORM_BUILD_UNAVAILABLE_REASONS),
  }),
]);

/** A Jenkins build agent as the controller reports it. */
export const PlatformAgent = z.object({
  name: z.string().min(1).max(100),
  online: z.boolean(),
  executors: z.number().int().nonnegative(),
  busy: z.boolean(),
  /** Short offline reason reported by Jenkins; null when online or not stated. */
  offlineReason: z.string().max(160).nullable(),
});
export const PlatformQueue = z.object({
  length: z.number().int().nonnegative(),
  /** Items Jenkins itself flags as stuck. */
  stuck: z.number().int().nonnegative(),
  /** Longest wait of a queued item; null when the queue is empty. */
  oldestWaitMs: z.number().int().nonnegative().nullable(),
});
/** Agents and queue of the controller; unreadable state is explicit, never an empty fleet. */
export const PlatformBuildInfrastructure = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("observed"),
    agents: z.array(PlatformAgent).max(32),
    queue: PlatformQueue,
  }),
  z.object({ state: z.literal("unavailable"), reason: z.enum(PLATFORM_BUILD_UNAVAILABLE_REASONS) }),
]);
export type PlatformBuildInfrastructureView = z.infer<typeof PlatformBuildInfrastructure>;

/**
 * Read-only view of the platform's own Jenkins builds. Local mode and a missing binding are
 * explicit "not connected" states; no build is ever fabricated.
 */
export const PlatformBuilds = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("not_connected"),
    reason: z.enum(PLATFORM_BUILD_NOT_CONNECTED_REASONS),
  }),
  z.object({
    state: z.literal("connected"),
    observedAt: Moment,
    jobs: z.array(PlatformBuildJob).max(8),
    /** Absent when the source cannot report agents and queue. */
    infrastructure: PlatformBuildInfrastructure.optional(),
  }),
]);
export type PlatformBuildView = z.infer<typeof PlatformBuild>;
export type PlatformBuildJobView = z.infer<typeof PlatformBuildJob>;
export type PlatformBuildsView = z.infer<typeof PlatformBuilds>;
export type PlatformBuildUnavailableReason = (typeof PLATFORM_BUILD_UNAVAILABLE_REASONS)[number];
