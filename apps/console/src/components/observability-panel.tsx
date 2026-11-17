import type {
  ObservabilityHealthView,
  ObservabilityTimelineView,
  ProjectDTO,
  TelemetryPageView,
} from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { resource, timestamp } from "@/lib/api";
import { AGENT_REFRESH_MS } from "./agents-labels";
import { IncidentsPanel } from "./incidents-panel";
import { Failure, Loading } from "./shared";
import { TelemetryFilters } from "./telemetry-filters";
import { queryString } from "./telemetry-shared";
import { Button } from "./ui/button";

const freshness: Record<string, string> = {
  fresh: "Récente",
  stale: "Périmée",
  missing: "Manquante",
  unavailable: "Indisponible",
  unknown: "Inconnue",
};
export function ProjectTimeline({
  projectId,
  environmentId,
}: {
  projectId?: string;
  environmentId?: string;
}) {
  const query = queryString({ projectId: projectId ?? "", environmentId: environmentId ?? "" });
  const timeline = useQuery(
    resource<ObservabilityTimelineView>(`timeline:${query}`, `/observability/timeline?${query}`),
  );
  return (
    <section className="card" aria-labelledby="timeline-title">
      <div className="card-head">
        <h2 id="timeline-title">Chronologie corrélée</h2>
        <span className="legend">seules les identités explicites corrèlent</span>
      </div>
      {timeline.isError ? (
        <Failure error={timeline.error} retry={() => void timeline.refetch()} />
      ) : !timeline.data ? (
        <Loading />
      ) : (
        <>
          {!timeline.data.entries.length && (
            <p className="faint">Aucune entrée dans ce périmètre.</p>
          )}
          <ol className="timeline-rows">
            {timeline.data.entries.slice(0, 20).map((entry) => (
              <li key={`${entry.kind}:${entry.id}`}>
                <time className="mono faint" dateTime={entry.occurredAt}>
                  {timestamp(entry.occurredAt)}
                </time>
                <span className="tag mono">{entry.kind}</span>
                <span>{entry.state}</span>
                <span className="mono faint" title={entry.id}>
                  {entry.correlation
                    ? `${entry.correlation.kind} ${entry.correlation.id.slice(0, 8)}`
                    : "sans corrélation"}
                </span>
              </li>
            ))}
          </ol>
          {(timeline.data.truncated || timeline.data.entries.length > 20) && (
            <p className="faint small">Chronologie tronquée aux entrées les plus récentes.</p>
          )}
        </>
      )}
    </section>
  );
}

function TelemetryFeed({
  kind,
  filters,
}: {
  kind: "logs" | "metrics";
  filters: Record<string, string>;
}) {
  const [cursor, setCursor] = useState("");
  const query = queryString({ ...filters, cursor });
  const result = useQuery(
    resource<TelemetryPageView>(`telemetry:${kind}:${query}`, `/observability/${kind}?${query}`),
  );
  return (
    <section className="panel telemetry-section">
      <h2>{kind === "logs" ? "Événements structurés" : "Mesures locales du contrôleur"}</h2>
      <p>
        {kind === "logs"
          ? "Événements fixes expurgés ; aucun stdout brut ni contenu de requête."
          : "Échantillons réels du processus : CPU en microsecondes cumulées, mémoire en octets. Aucun pourcentage CPU ou métrique distante déduit."}
      </p>
      {result.isError ? (
        <Failure error={result.error} retry={() => void result.refetch()} />
      ) : !result.data ? (
        <Loading />
      ) : (
        <>
          {result.data.gap && (
            <p role="alert">
              Lacune de rétention ou de curseur : cette page ne prouve pas un historique continu.
            </p>
          )}
          <p>Rétention : {result.data.retentionDays} jours · continuité des sources inconnue.</p>
          {!result.data.records.length && <p>Aucun échantillon conservé pour ce périmètre.</p>}
          {result.data.records.map((r) => (
            <details className="telemetry-record" key={r.id}>
              <summary>
                {timestamp(r.observedAt)} · {r.event} · {r.code} · {r.state}
              </summary>
              <p>
                Source {r.sourceId} · curseur {r.cursor} · reçu {timestamp(r.receivedAt)}
              </p>
              <p>
                Niveau {r.level} · projet {r.scope.projectId ?? "Global"} · environnement{" "}
                {r.scope.environmentId ?? "—"}
              </p>
              <p>
                Corrélation :{" "}
                {r.correlation ? `${r.correlation.kind} / ${r.correlation.id}` : "Aucune"}
              </p>
              {r.metrics.map((m) => (
                <p className="mono" key={m.name}>
                  {m.name} : {m.value}
                </p>
              ))}
            </details>
          ))}
          <div className="button-row">
            <Button variant="outline" disabled={!cursor} onClick={() => setCursor("")}>
              Première page
            </Button>
            <Button
              variant="outline"
              disabled={!result.data.records.length || String(result.data.nextCursor) === cursor}
              onClick={() => setCursor(String(result.data.nextCursor))}
            >
              Échantillons suivants
            </Button>
            <Button variant="outline" onClick={() => void result.refetch()}>
              Actualiser les échantillons
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

export function ObservabilityPanel() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const query = queryString(filters);
  const health = useQuery({
    ...resource<ObservabilityHealthView>(`health:${query}`, `/observability/health?${query}`),
    refetchInterval: AGENT_REFRESH_MS,
  });
  const projects = useQuery(resource<ProjectDTO[]>("projects", "/projects"));
  return (
    <div className="telemetry-stack">
      <section className="panel telemetry-section">
        <h2>Périmètre des observations</h2>
        {projects.data ? (
          <TelemetryFilters projects={projects.data} values={filters} change={setFilters} />
        ) : projects.isError ? (
          <Failure error={projects.error} />
        ) : (
          <Loading />
        )}
      </section>
      <section className="panel telemetry-section">
        <h2>Sources et fraîcheur</h2>
        {health.isError ? (
          <Failure error={health.error} retry={() => void health.refetch()} />
        ) : !health.data ? (
          <Loading />
        ) : (
          <>
            <p>
              Métriques d’hôte distant indisponibles. Observateur externe :{" "}
              {health.data.externalObserver === "configured" ? "configuré" : "non configuré"}. Un
              hôte arrêté ne peut pas constater sa propre perte.
            </p>
            {health.data.truncated && <p>Liste des sources tronquée.</p>}
            {!health.data.sources.length && (
              <p>Aucune source enregistrée. L’absence d’observation ne prouve pas un état sain.</p>
            )}
            {health.data.sources.map((h) => (
              <div className="telemetry-record" key={h.source.id}>
                <strong>
                  {h.source.name} · {freshness[h.freshness]}
                </strong>
                <p>
                  État souhaité : {h.desiredState} · état observé : {h.observedState ?? "Inconnu"}
                </p>
                <p>
                  Observé : {h.observedAt ? timestamp(h.observedAt) : "Jamais"} · reçu :{" "}
                  {h.receivedAt ? timestamp(h.receivedAt) : "Jamais"} · seuil{" "}
                  {h.source.staleAfterSeconds} s
                </p>
                <p>
                  Source {h.source.id} · {h.source.kind} · projet{" "}
                  {h.source.scope.projectId ?? "Global"} · environnement{" "}
                  {h.source.scope.environmentId ?? "—"}
                </p>
              </div>
            ))}
            <Button variant="outline" onClick={() => void health.refetch()}>
              Actualiser les sources
            </Button>
          </>
        )}
      </section>
      <TelemetryFeed key={`logs:${query}`} kind="logs" filters={filters} />
      <TelemetryFeed key={`metrics:${query}`} kind="metrics" filters={filters} />
      <ProjectTimeline projectId={filters.projectId} environmentId={filters.environmentId} />
      <div id="incidents">{projects.data && <IncidentsPanel projects={projects.data} />}</div>
    </div>
  );
}
