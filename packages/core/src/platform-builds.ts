import {
  PLATFORM_BUILD_JOBS,
  PLATFORM_BUILD_LIMIT,
  type PlatformBuildJobView,
  type PlatformBuildsView,
  type PlatformBuildUnavailableReason,
  type PlatformBuildView,
} from "@godseye/contracts";
import { type Actor, assertOwner } from "./policy.js";

/** Failure of the build source with a reason that is safe to show to the owner. */
export class PlatformBuildsError extends Error {
  constructor(readonly reason: PlatformBuildUnavailableReason) {
    super(`Platform builds unavailable: ${reason}`);
    this.name = "PlatformBuildsError";
  }
}

/** Reads the most recent builds of one job; adapters own transport, authentication and timeouts. */
export interface PlatformBuildSource {
  recentBuilds(job: string, limit: number): Promise<PlatformBuildView[]>;
}

export interface PlatformBuildsOptions {
  mode: "local" | "server";
  /** Absent until a private Jenkins binding exists. */
  source?: PlatformBuildSource | null;
  jobs?: readonly string[];
  now?: () => Date;
}

/** Owner-only, read-only view of the platform's own Jenkins builds. */
export class PlatformBuilds {
  constructor(private readonly options: PlatformBuildsOptions) {}

  /** True only when a Jenkins binding exists, whatever the controller's current health. */
  get configured() {
    return this.options.mode === "server" && Boolean(this.options.source);
  }

  async observe(actor: Actor): Promise<PlatformBuildsView> {
    assertOwner(actor);
    const { mode, source } = this.options;
    if (mode !== "server") return { state: "not_connected", reason: "LOCAL_MODE" };
    if (!source) return { state: "not_connected", reason: "NOT_CONFIGURED" };
    const jobs = await Promise.all(
      (this.options.jobs ?? PLATFORM_BUILD_JOBS).map((name) => this.job(source, name)),
    );
    return {
      state: "connected",
      observedAt: (this.options.now?.() ?? new Date()).toISOString(),
      jobs,
    };
  }

  private async job(source: PlatformBuildSource, name: string): Promise<PlatformBuildJobView> {
    try {
      const builds = await source.recentBuilds(name, PLATFORM_BUILD_LIMIT);
      return { name, state: "observed", builds: builds.slice(0, PLATFORM_BUILD_LIMIT) };
    } catch (error) {
      return {
        name,
        state: "unavailable",
        reason: error instanceof PlatformBuildsError ? error.reason : "ERROR",
      };
    }
  }
}
