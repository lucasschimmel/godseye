import type {
  LifecycleBlockerView,
  OwnerSecurityView,
  ProjectLifecycleView,
  ProjectView,
} from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, resource, timestamp } from "@/lib/api";
import { EmptyState, Failure, Loading, SectionTitle, Status } from "./shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const serviceLabels: Record<ProjectLifecycleView["services"][number]["service"], string> = {
  jobs: "Jobs et outbox",
  backend: "Backend applicatif",
  delivery: "Livraison",
  databases: "Bases de données",
  cells: "Cellules d’exécution",
  backups: "Sauvegardes",
};
const blockerLabels: Record<LifecycleBlockerView["code"], string> = {
  SUSPEND_REQUIRED: "Suspendez le projet avant d’engager sa suppression.",
  EXPORT_REQUIRED: "Exportez la révision actuelle avant la quarantaine.",
  ACTIVE_JOB_RUNS: "Des exécutions de jobs sont actives ou incertaines.",
  ACTIVE_OUTBOX_EFFECTS: "Des effets sortants sont en cours ou à réconcilier.",
  ACTIVE_OPERATIONS: "Des opérations sont en cours ou à réconcilier.",
  ACTIVE_ROTATIONS: "Des rotations de rôles de base sont à résoudre.",
  UNCONFIRMED_ALLOCATIONS: "L’état physique de certaines bases n’est pas confirmé.",
  RETENTION_ACTIVE: "Le délai de quarantaine n’est pas écoulé.",
  RESIDUAL_RESOURCES: "Des ressources physiques doivent d’abord être libérées.",
  ALREADY_PURGED: "Ce projet est déjà purgé.",
};
const stateLabels = {
  enforced: "Bloqué par la plateforme",
  "pending-provider": "Action fournisseur requise",
  none: "Sans objet",
} as const;
const residualLabels = {
  database: "Base",
  cell: "Cellule",
  "delivery-run": "Livraison",
  preview: "Preview",
  backup: "Sauvegarde",
} as const;
const post = (path: string, body: unknown) =>
  api<ProjectLifecycleView>(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "idempotency-key": crypto.randomUUID() },
  });

/** Suspension, export and staged deletion; the panel never implies a physical resource was stopped. */
export function LifecyclePanel({ project }: { project: ProjectView }) {
  const view = useQuery(
    resource<ProjectLifecycleView>(`lifecycle-${project.id}`, `/projects/${project.id}/lifecycle`),
  );
  const security = useQuery(resource<OwnerSecurityView>("owner-security", "/owner/security"));
  const cache = useQueryClient();
  const [confirmation, setConfirmation] = useState("");
  const mutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => post(path, body),
    onSuccess: () => cache.invalidateQueries(),
  });
  if (view.isPending) return <Loading />;
  if (view.isError) return <Failure error={view.error} retry={() => void view.refetch()} />;
  const lifecycle = view.data;
  const fresh = security.data?.fresh === true;
  const base = `/projects/${project.id}`;
  const latest = lifecycle.exports.find((item) => item.projectRevision === lifecycle.revision);
  const run = (action: string, extra: Record<string, unknown> = {}) =>
    mutation.mutate({
      path: `${base}/lifecycle/${action}`,
      body: { expectedRevision: lifecycle.revision, ...extra },
    });
  return (
    <section aria-label="Cycle de vie du projet">
      <SectionTitle count={lifecycle.exports.length}>Cycle de vie et suppression</SectionTitle>
      <div className="project-summary">
        <Status value={lifecycle.phase} />
        <span className="mono">Révision {lifecycle.revision}</span>
        {lifecycle.purgeAfter && (
          <span>Purge possible après le {timestamp(lifecycle.purgeAfter)}</span>
        )}
      </div>
      <p className="muted">
        Ces commandes agissent sur les métadonnées de contrôle. Elles ne stoppent aucune ressource
        physique : les services signalés « Action fournisseur requise » restent à traiter.
      </p>
      {mutation.isError && <Failure error={mutation.error} />}
      <div className="environment-grid">
        <section className="panel environment-card" aria-label="Couverture des services">
          <h3>Services concernés</h3>
          <ul>
            {lifecycle.services.map((service) => (
              <li key={service.service}>
                <strong>{serviceLabels[service.service]}</strong> · {stateLabels[service.state]}
                <span className="muted"> {service.detail}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel environment-card" aria-label="Ressources restantes">
          <h3>Ressources restantes</h3>
          {lifecycle.residual.length === 0 ? (
            <EmptyState
              title="Aucune ressource physique enregistrée"
              description="La purge n’est pas bloquée par des ressources."
            />
          ) : (
            <ul>
              {lifecycle.residual.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  {residualLabels[item.kind]} · <span className="mono">{item.state}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {lifecycle.blockers.length > 0 && (
        <ul aria-label="Conditions manquantes" className="muted">
          {lifecycle.blockers.map((blocker) => (
            <li key={blocker.code}>
              {blockerLabels[blocker.code]}
              {blocker.count > 1 ? ` (${blocker.count})` : ""}
            </li>
          ))}
        </ul>
      )}
      <div className="button-row">
        {lifecycle.phase === "active" && (
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => run("suspend", { reason: "Suspension demandée par le propriétaire" })}
          >
            Suspendre le projet
          </Button>
        )}
        {lifecycle.phase === "suspended" && (
          <Button variant="outline" disabled={mutation.isPending} onClick={() => run("resume")}>
            Reprendre le projet
          </Button>
        )}
        {lifecycle.phase !== "purged" && (
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({
                path: `${base}/exports`,
                body: { expectedRevision: lifecycle.revision },
              })
            }
          >
            Exporter les métadonnées
          </Button>
        )}
        {lifecycle.phase === "suspended" && (
          <Button
            disabled={mutation.isPending || !fresh || !lifecycle.quarantinable || !latest}
            onClick={() =>
              latest &&
              run("quarantine", {
                exportId: latest.id,
                reason: "Suppression progressive demandée par le propriétaire",
              })
            }
          >
            Mettre en quarantaine
          </Button>
        )}
        {lifecycle.phase === "quarantined" && (
          <Button variant="outline" disabled={mutation.isPending} onClick={() => run("release")}>
            Annuler la quarantaine
          </Button>
        )}
      </div>
      {lifecycle.phase === "quarantined" && (
        <form
          className="panel project-form"
          aria-label="Purger le projet"
          onSubmit={(event) => {
            event.preventDefault();
            run("purge", { confirmSlug: confirmation });
          }}
        >
          <label htmlFor="purge-confirmation">
            Saisissez l’identifiant « {lifecycle.slug} » pour confirmer
            <Input
              id="purge-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
          <Button
            type="submit"
            disabled={mutation.isPending || !fresh || confirmation !== lifecycle.slug}
          >
            Purger définitivement
          </Button>
        </form>
      )}
      {!fresh && (
        <p className="muted">
          Une confirmation récente par clé d’accès est requise pour la quarantaine et la purge.
        </p>
      )}
      {lifecycle.exports.length > 0 && (
        <ul aria-label="Exports de métadonnées">
          {lifecycle.exports.map((item) => (
            <li key={item.id}>
              Révision {item.projectRevision} ·{" "}
              <span className="mono">{item.digest.slice(0, 12)}</span> · {timestamp(item.createdAt)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
