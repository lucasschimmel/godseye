import {
  PLATFORM_BUILD_JOBS,
  PLATFORM_BUILD_LIMIT,
  type PlatformBuildInfrastructureView,
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
  /** Origin of the controller; without it no build link is ever offered for a CI run. */
  readonly origin?: string;
  recentBuilds(job: string, limit: number): Promise<PlatformBuildView[]>;
  /** Agents and queue of the controller; adapters that cannot report them omit it. */
  infrastructure?(): Promise<PlatformBuildInfrastructureView>;
}

export interface PlatformBuildsOptions {
  mode: "local" | "server";
  /** Absent until a private Jenkins binding exists. */
  source?: PlatformBuildSource | null;
  jobs?: readonly string[];
  now?: () => Date;
}

/** Build links are re-read at most this often so a slow controller cannot stall the run list. */
export const BUILD_LINKS_TTL_MS = 30_000;
/** Longest provider reference the CI run contract accepts. */
const PROVIDER_REF_MAX = 256;

type BuildLinks = ReadonlyMap<string, string>;

/** Fills `providerRef` from a known build link; a recorded reference is never overwritten. */
export function withBuildLinks<T extends { commitSha: string; providerRef?: string | null }>(
  runs: readonly T[],
  links: BuildLinks,
): T[] {
  return runs.map((run) => {
    const link = run.providerRef ? undefined : links.get(run.commitSha);
    return link ? { ...run, providerRef: link } : run;
  });
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/** Owner-only, read-only view of the platform's own Jenkins builds. */
export class PlatformBuilds {
  private links: { at: number; value: BuildLinks } | null = null;

  constructor(private readonly options: PlatformBuildsOptions) {}

  /** True only when a Jenkins binding exists, whatever the controller's current health. */
  get configured() {
    return this.options.mode === "server" && Boolean(this.options.source);
  }

  async observe(actor: Actor): Promise<PlatformBuildsView> {
    assertOwner(actor);
    return this.observeSystem();
  }

  /** Same read-only view for the controller's own detectors (no owner session involved). */
  async observeSystem(): Promise<PlatformBuildsView> {
    const { mode, source } = this.options;
    if (mode !== "server") return { state: "not_connected", reason: "LOCAL_MODE" };
    if (!source) return { state: "not_connected", reason: "NOT_CONFIGURED" };
    const jobs = await Promise.all(
      (this.options.jobs ?? PLATFORM_BUILD_JOBS).map((name) => this.job(source, name)),
    );
    const infrastructure = source.infrastructure
      ? await source.infrastructure().catch(
          (error): PlatformBuildInfrastructureView => ({
            state: "unavailable",
            reason: error instanceof PlatformBuildsError ? error.reason : "ERROR",
          }),
        )
      : undefined;
    return {
      state: "connected",
      observedAt: (this.options.now?.() ?? new Date()).toISOString(),
      jobs,
      ...(infrastructure ? { infrastructure } : {}),
    };
  }

  /**
   * Commit SHA to Jenkins build URL, only for builds that report the commit they built and whose
   * URL is on the configured controller origin. Unreadable Jenkins yields no links, never a guess.
   */
  async buildLinks(actor: Actor): Promise<BuildLinks> {
    assertOwner(actor);
    const clock = (this.options.now?.() ?? new Date()).getTime();
    if (this.links && clock - this.links.at < BUILD_LINKS_TTL_MS) return this.links.value;
    const origin = this.options.source?.origin;
    const view = await this.observe(actor);
    const links = new Map<string, string>();
    if (origin && view.state === "connected") {
      const startedAt = new Map<string, string>();
      for (const job of view.jobs) {
        if (job.state !== "observed") continue;
        for (const build of job.builds) {
          const sha = build.commitSha;
          if (!sha || build.url.length > PROVIDER_REF_MAX || !sameOrigin(build.url, origin))
            continue;
          const seen = startedAt.get(sha);
          if (seen === undefined || build.startedAt > seen) {
            startedAt.set(sha, build.startedAt);
            links.set(sha, build.url);
          }
        }
      }
    }
    this.links = { at: clock, value: links };
    return links;
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
