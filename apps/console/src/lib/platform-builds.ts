import type {
  PlatformBuildsView,
  PlatformBuildUnavailableReason,
  PlatformBuildView,
} from "@godseye/contracts";

/** Refresh cadence while at least one build is running; idle pages do not poll. */
export const PLATFORM_BUILDS_REFRESH_MS = 15_000;

export const platformJobLabels: Record<string, string> = {
  "godseye-platform": "Plateforme (suit main)",
  "godseye-platform-candidate": "Candidat (lancé à la main)",
};

export const platformUnavailableLabel = {
  UNREACHABLE: "Jenkins injoignable depuis l’API",
  TIMEOUT: "Jenkins n’a pas répondu à temps",
  UNAUTHORIZED: "Jenkins a refusé l’accès (jeton)",
  NOT_FOUND: "Job introuvable sur Jenkins",
  INVALID: "Réponse Jenkins illisible",
  ERROR: "Erreur inattendue en lisant Jenkins",
} as const satisfies Record<PlatformBuildUnavailableReason, string>;

export const platformNotConnectedLabel = {
  LOCAL_MODE: "Mode local : l’API n’est pas raccordée au Jenkins du serveur.",
  NOT_CONFIGURED: "Aucun accès en lecture à Jenkins n’est configuré sur le serveur.",
} as const;

export type BuildBadge = { tone: "succeeded" | "running" | "failed" | "neutral"; label: string };

/** One badge per build; a build without a result is shown as running, never as a success. */
export function buildBadge(build: Pick<PlatformBuildView, "building" | "result">): BuildBadge {
  if (build.building || build.result === null) return { tone: "running", label: "En cours" };
  switch (build.result) {
    case "SUCCESS":
      return { tone: "succeeded", label: "Réussi" };
    case "FAILURE":
      return { tone: "failed", label: "Échec" };
    case "UNSTABLE":
      return { tone: "running", label: "Instable" };
    case "ABORTED":
      return { tone: "neutral", label: "Interrompu" };
    case "NOT_BUILT":
      return { tone: "neutral", label: "Non construit" };
  }
}

/** Compact French duration: "42 s", "3 min 05 s", "1 h 02 min". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `${seconds} s`;
}

/** Elapsed time of a running build or recorded duration of a finished one. */
export function buildDuration(build: PlatformBuildView, nowMs: number): string {
  if (build.building || build.result === null)
    return formatDuration(nowMs - new Date(build.startedAt).getTime());
  return build.durationMs === null ? "—" : formatDuration(build.durationMs);
}

/** True when any listed build is still running, which is what keeps the panel refreshing. */
export function hasRunningBuild(data: PlatformBuildsView | undefined): boolean {
  return (
    data?.state === "connected" &&
    data.jobs.some(
      (job) =>
        job.state === "observed" &&
        job.builds.some((build) => build.building || build.result === null),
    )
  );
}

/** Links are offered only for plain http(s) URLs without embedded credentials. */
export function safeBuildUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const web = url.protocol === "https:" || url.protocol === "http:";
    return web && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
