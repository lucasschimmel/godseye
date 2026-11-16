import type { PlatformBuildJobView, PlatformBuildsView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { Hammer } from "lucide-react";
import { useEffect, useState } from "react";
import { Failure, Loading, SectionTitle } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { resource, timestamp } from "@/lib/api";
import {
  buildBadge,
  buildDuration,
  hasRunningBuild,
  PLATFORM_BUILDS_REFRESH_MS,
  platformJobLabels,
  platformNotConnectedLabel,
  platformUnavailableLabel,
  safeBuildUrl,
} from "@/lib/platform-builds";
import { TableScroll } from "./table-scroll";

function JobBuilds({ job, nowMs }: { job: PlatformBuildJobView; nowMs: number }) {
  const label = platformJobLabels[job.name] ?? job.name;
  return (
    <div className="platform-job" data-testid={`platform-job-${job.name}`}>
      <h3>
        {label} <span className="muted mono">{job.name}</span>
      </h3>
      {job.state === "unavailable" ? (
        <p className="panel-caption" role="status">
          Indisponible · {platformUnavailableLabel[job.reason]}
        </p>
      ) : job.builds.length === 0 ? (
        <p className="panel-caption">Aucun build enregistré pour ce job.</p>
      ) : (
        <TableScroll label={`Tableau défilant : ${label}`}>
          <table className="headroom-table">
            <caption className="sr-only">Derniers builds de {label}</caption>
            <thead>
              <tr>
                <th scope="col">Build</th>
                <th scope="col">État</th>
                <th scope="col">Branche</th>
                <th scope="col">Démarré</th>
                <th scope="col">Durée</th>
              </tr>
            </thead>
            <tbody>
              {job.builds.map((build) => {
                const badge = buildBadge(build);
                const href = safeBuildUrl(build.url);
                return (
                  <tr key={build.number}>
                    <th scope="row" className="mono">
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer noopener">
                          #{build.number}
                        </a>
                      ) : (
                        `#${build.number}`
                      )}
                    </th>
                    <td>
                      <Badge variant="outline" className={`state state-${badge.tone}`}>
                        <span className="status-dot" />
                        {badge.label}
                      </Badge>
                    </td>
                    <td className="mono">{build.branch ?? "—"}</td>
                    <td>{timestamp(build.startedAt)}</td>
                    <td>
                      {badge.label === "En cours"
                        ? `en cours depuis ${buildDuration(build, nowMs)}`
                        : buildDuration(build, nowMs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
}

/** Pure rendering of the platform builds; the caller owns fetching and the clock. */
export function PlatformBuildsBody({ data, nowMs }: { data: PlatformBuildsView; nowMs: number }) {
  if (data.state === "not_connected")
    return (
      <p className="quiet-empty" role="status">
        Non raccordé · {platformNotConnectedLabel[data.reason]} Aucun build n’est affiché.
      </p>
    );
  return (
    <div className="panel-body">
      <p className="panel-caption">Relevé du {timestamp(data.observedAt)}</p>
      {data.jobs.map((job) => (
        <JobBuilds key={job.name} job={job} nowMs={nowMs} />
      ))}
    </div>
  );
}

/** Builds of the platform's own Jenkins jobs; refreshes every 15 s only while one is running. */
export function PlatformBuildsPanel() {
  const query = useQuery({
    ...resource<PlatformBuildsView>("platform-builds", "/infrastructure/jenkins"),
    refetchInterval: (state) =>
      hasRunningBuild(state.state.data) ? PLATFORM_BUILDS_REFRESH_MS : false,
  });
  const running = hasRunningBuild(query.data);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  return (
    <section
      className="panel"
      aria-labelledby="platform-builds-title"
      data-testid="platform-builds"
    >
      <div className="panel-heading">
        <SectionTitle>
          <span id="platform-builds-title">Builds de la plateforme</span>
        </SectionTitle>
        <Hammer size={18} />
      </div>
      <p className="panel-note">
        Lecture seule des derniers builds Jenkins de G.O.D.S.E.Y.E elle-même. Si Jenkins ne répond
        pas, l’état est indiqué « Indisponible » : aucun historique n’est supposé.
      </p>
      {query.isPending ? (
        <Loading />
      ) : query.isError || !query.data ? (
        <Failure
          error={query.error ?? new Error("Builds indisponibles.")}
          retry={() => void query.refetch()}
        />
      ) : (
        <PlatformBuildsBody data={query.data} nowMs={nowMs} />
      )}
    </section>
  );
}
