import type { IncidentOverviewView, IncidentView, ProjectDTO } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { resource, timestamp } from "@/lib/api";
import { ProtectionBadge, reasonLabels } from "./protection-labels";
import { EmptyState, Failure, Loading, SectionTitle } from "./shared";
import { useTelemetryMutation } from "./telemetry-shared";
import { Button } from "./ui/button";

const kinds: Record<IncidentView["kind"], string> = {
  "archive-lag": "Retard d’archive",
  headroom: "Marge d’archive",
  "rotation-failure": "Échec de rotation",
  health: "Santé d’une source",
  provider: "Fournisseur",
  accounting: "Comptabilité inconnue",
  budget: "Budget",
  "external-uptime": "Disponibilité externe",
};
const deliveries: Record<IncidentView["delivery"]["state"], string> = {
  unconfigured: "Enregistré. Aucune notification externe n’est configurée.",
  pending: "Notification en attente.",
  notified: "Notification externe confirmée.",
  failed: "Notification externe en échec.",
  delivering: "Notification en cours de livraison, sans confirmation.",
  unknown: "Résultat de notification inconnu ; aucun envoi confirmé.",
};
const MUTE_MS = 3_600_000;
function scopeName(projects: ProjectDTO[], projectId: string | null, environmentId: string | null) {
  if (!projectId) return "Périmètre global";
  const project = projects.find((p) => p.id === projectId);
  const environment = project?.environments.find((e) => e.id === environmentId);
  return `${project?.name ?? projectId}${environmentId ? ` · ${environment?.name ?? environmentId}` : " · projet"}`;
}
/** Owner incident list: acknowledge, mute with expiry, resolve. Raised never implies notified. */
export function IncidentsPanel({ projects }: { projects: ProjectDTO[] }) {
  const overview = useQuery(resource<IncidentOverviewView>("incidents", "/incidents"));
  const mutation = useTelemetryMutation();
  if (overview.isPending) return <Loading />;
  if (overview.isError)
    return <Failure error={overview.error} retry={() => void overview.refetch()} />;
  const { notifier, incidents } = overview.data;
  const active = incidents.filter((item) => item.state !== "resolved");
  const act = (item: IncidentView, action: string, extra: object = {}) =>
    mutation.mutate({
      method: "POST",
      path: `/incidents/${item.id}/${action}`,
      body: { expectedRevision: item.revision, ...extra },
    });
  return (
    <section aria-label="Incidents">
      <SectionTitle count={active.length}>Incidents</SectionTitle>
      <p className="muted">
        {notifier === "configured"
          ? "Un canal de notification externe est configuré ; seul l’état « Notification externe confirmée » prouve un envoi."
          : "Aucun canal de notification externe n’est configuré : les incidents sont enregistrés ici, personne n’est prévenu automatiquement."}{" "}
        Les observations absentes ou périmées ne prouvent pas la disparition d’un incident.
      </p>
      <Button
        variant="outline"
        disabled={mutation.isPending}
        onClick={() =>
          mutation.mutate({ method: "POST", path: "/incidents/evaluations", body: {} })
        }
      >
        Réévaluer les incidents
      </Button>
      {mutation.isError && <Failure error={mutation.error} />}
      {incidents.length === 0 ? (
        <EmptyState
          title="Aucun incident enregistré"
          description="Aucun incident conservé. L’absence d’incident ne prouve pas la santé des sources non observées."
        />
      ) : (
        <div className="environment-grid">
          {incidents.map((item) => (
            <section
              className="panel environment-card"
              key={item.id}
              aria-label={`Incident ${kinds[item.kind]} ${scopeName(projects, item.projectId, item.environmentId)}`}
            >
              <h3>
                {kinds[item.kind]}
                {item.subject ? ` · ${item.subject}` : ""}
              </h3>
              <p>{scopeName(projects, item.projectId, item.environmentId)}</p>
              <ProtectionBadge value={item.state} />
              <p>
                {item.severity === "critical" ? "Critique" : "Avertissement"}.{" "}
                {reasonLabels[item.reason] ?? item.reason} {item.summary}
              </p>
              <p>
                {item.occurrences} constat(s), dernier le {timestamp(item.lastRaisedAt)}.
              </p>
              <p role="status">{deliveries[item.delivery.state]}</p>
              {item.muted && item.mutedUntil && (
                <p>En sourdine jusqu’au {timestamp(item.mutedUntil)}.</p>
              )}
              {item.resolution && (
                <p>
                  {item.resolution === "cleared"
                    ? "Résolu : condition disparue."
                    : "Résolu manuellement."}
                </p>
              )}
              {item.state !== "resolved" && (
                <div className="button-row">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={mutation.isPending || item.state === "acknowledged"}
                    onClick={() => act(item, "acknowledge")}
                  >
                    Acquitter
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={mutation.isPending}
                    onClick={() =>
                      act(item, "mute", { until: new Date(Date.now() + MUTE_MS).toISOString() })
                    }
                  >
                    Mettre en sourdine une heure
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={mutation.isPending}
                    onClick={() => act(item, "resolve")}
                  >
                    Résoudre
                  </Button>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
