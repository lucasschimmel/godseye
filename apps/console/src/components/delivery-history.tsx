import type { CiRunView, DeliveryOverviewView, ProjectDTO } from "@godseye/contracts";
import { timestamp } from "@/lib/api";
import { AdmitControl, MigrationNote, ScanNote, UsageNote } from "./delivery-evidence";
import { EmptyState, SectionTitle } from "./shared";
import { Button } from "./ui/button";

const labels: Record<string, string> = {
  reserved: "Réservé",
  building: "Construction",
  built: "Artefact vérifié",
  staged: "Préparé",
  active: "Actif vérifié",
  retired: "Retiré",
  released: "Libéré sans effet",
  unknown: "Résultat incertain",
  quarantined: "En quarantaine",
  prepared: "Cellule préparée",
  "cleanup-required": "Arrêt requis",
};
const intents: Record<string, string> = {
  build: "Construction",
  release: "Déploiement",
  rollback: "Retour d’image",
  cleanup: "Arrêt de preview",
};
function safePreviewUrl(value: string | null) {
  if (!value || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}
export function DeliveryHistory({
  overview,
  projects,
  ciRuns,
  disabled,
  sourceAvailable,
  executionAvailable,
  post,
  now = Date.now(),
}: {
  overview: DeliveryOverviewView;
  projects: ProjectDTO[];
  ciRuns: CiRunView[];
  disabled: boolean;
  sourceAvailable: boolean;
  executionAvailable: boolean;
  post: (path: string, body: unknown) => void;
  now?: number;
}) {
  const projectName = (id: string) => projects.find((row) => row.id === id)?.name ?? "Projet";
  return (
    <>
      <section className="panel delivery-history">
        <SectionTitle count={overview.policies.length}>Politiques enregistrées</SectionTitle>
        {!overview.policies.length && (
          <EmptyState
            title="Aucune politique de livraison"
            description="Enregistrez une autorité bornée pour un projet et un environnement. La simple association GitHub n’autorise aucun déploiement."
          />
        )}
        {overview.policies.map((policy) => (
          <div className="operation-row" key={policy.id}>
            <div>
              <strong>{projectName(policy.projectId)}</strong>
              <p className="mono">
                {policy.repository.fullName} · {policy.repository.branch}
              </p>
              <small>
                {policy.revokedAt
                  ? "Révoquée"
                  : Date.parse(policy.expiresAt) <= Date.now()
                    ? "Expirée"
                    : policy.autoDeploy
                      ? "Automatique sous contrôles"
                      : "Validation manuelle"}{" "}
                · jusqu’au {timestamp(policy.expiresAt)} ·{" "}
                {policy.recipe.kind === "node" ? "Back-end Node.js" : "Site statique"}
              </small>
            </div>
            <div className="button-group">
              <Button
                variant="outline"
                disabled={disabled || !sourceAvailable || !!policy.revokedAt}
                onClick={() => post("/delivery/synchronize", { policyId: policy.id })}
              >
                Synchroniser GitHub
              </Button>
              <Button
                variant="outline"
                disabled={disabled || !!policy.revokedAt}
                onClick={() =>
                  post(`/delivery/policies/${policy.id}/revoke`, {
                    expectedRevision: policy.revision,
                  })
                }
              >
                Révoquer
              </Button>
            </div>
          </div>
        ))}
      </section>
      <section className="panel delivery-history">
        <SectionTitle count={overview.preparations.length}>Livraisons préparées</SectionTitle>
        {!overview.preparations.length && (
          <EmptyState
            title="Aucune livraison préparée"
            description="Les événements signés sont revérifiés auprès de GitHub avant toute sélection de code. Aucun SHA ou résultat de contrôle ne peut être saisi comme preuve."
          />
        )}
        {overview.preparations.map((row) => {
          const run = overview.deployments.find((item) => item.preparationId === row.id);
          const artifact = overview.artifacts.find((item) => item.preparationId === row.id);
          const rollbackPolicy = overview.policies.find(
            (policy) =>
              policy.projectId === row.projectId &&
              !policy.revokedAt &&
              Date.parse(policy.expiresAt) > now &&
              (policy.environmentId === row.environmentId ||
                overview.previews.some(
                  (preview) =>
                    preview.policyId === policy.id && preview.environmentId === row.environmentId,
                )),
          );
          const preview = overview.previews.find(
            (item) => item.environmentId === row.environmentId,
          );
          const rollbackSource = ciRuns.find(
            (ci) =>
              ci.projectId === row.projectId &&
              ci.eventAction !== "closed" &&
              (preview
                ? ci.trigger === "pull_request" &&
                  ci.pullRequestNumber === preview.pullRequestNumber
                : ci.branch === rollbackPolicy?.repository.branch && ci.trigger === "push"),
          );
          return (
            <div className="operation-row" key={row.id}>
              <div>
                <strong>
                  {projectName(row.projectId)} · {intents[row.intent]}
                </strong>
                <p className="mono">
                  {row.commitSha.slice(0, 12)} · {row.hash.slice(0, 12)}
                </p>
                <small>{run ? labels[run.state] : "Préparée, aucun effet exécuté"}</small>
                <MigrationNote preparation={row} />
                {artifact && <ScanNote artifact={artifact} />}
                <UsageNote usage={overview.usage.find((item) => item.runId === run?.runId)} />
                {run?.reason && (
                  <p role="status">
                    Contrôle bloquant : <span className="mono">{run.reason}</span>
                  </p>
                )}
              </div>
              <div className="button-group">
                {!run && (
                  <AdmitControl
                    preparation={row}
                    post={post}
                    disabled={
                      disabled ||
                      (row.intent !== "cleanup" && !sourceAvailable) ||
                      !executionAvailable
                    }
                  />
                )}
                {artifact && run?.state === "built" && (
                  <Button
                    variant="outline"
                    disabled={disabled || !sourceAvailable}
                    onClick={() =>
                      post("/delivery/preparations", {
                        policyId: row.policyId,
                        ciRunId: row.ciRunId,
                        intent: "release",
                        artifactId: artifact.id,
                      })
                    }
                  >
                    Préparer le déploiement
                  </Button>
                )}
                {run?.state === "unknown" && (
                  <Button
                    variant="outline"
                    disabled={disabled || !executionAvailable}
                    onClick={() => post(`/foundation/runs/${run.runId}/reconcile`, {})}
                  >
                    Réconcilier sans relancer
                  </Button>
                )}
                {run?.state === "retired" && row.intent !== "cleanup" && run.artifactId && (
                  <Button
                    variant="outline"
                    title={
                      overview.rollbackBlocked.includes(run.id)
                        ? "Retour d’image exclu : une migration ultérieure n’est pas rétrocompatible. Une restauration de données reste une opération distincte."
                        : undefined
                    }
                    disabled={
                      disabled ||
                      !sourceAvailable ||
                      !rollbackPolicy ||
                      !rollbackSource ||
                      overview.rollbackBlocked.includes(run.id)
                    }
                    onClick={() =>
                      post("/delivery/preparations", {
                        policyId: rollbackPolicy?.id,
                        ciRunId: rollbackSource?.id,
                        intent: "rollback",
                        deploymentId: run.id,
                      })
                    }
                  >
                    Préparer un retour d’image
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </section>
      <section className="panel delivery-history">
        <div className="panel-heading">
          <SectionTitle count={overview.previews.length}>Previews isolées</SectionTitle>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => post("/delivery/cleanup", {})}
          >
            Préparer l’arrêt des previews expirées
          </Button>
        </div>
        <p className="muted">
          Fermeture vérifiée d’une pull request ou TTL : arrêt et retrait de la route de preview.
          Les données persistantes et l’historique restent conservés ; aucune purge de base n’est
          autorisée.
        </p>
        {!overview.previews.length && (
          <EmptyState
            title="Aucune preview"
            description="Les pull requests du même dépôt peuvent recevoir une cellule vide distincte, avec durée et ressources bornées. Les forks ne sont pas exécutés."
          />
        )}
        {overview.previews.map((preview) => (
          <div className="operation-row" key={preview.id}>
            <div>
              <strong>
                {projectName(preview.projectId)} · PR #{preview.pullRequestNumber}
              </strong>
              <p>
                {Date.parse(preview.expiresAt) <= now && preview.state !== "retired"
                  ? "Expirée · arrêt physique à vérifier"
                  : labels[preview.state]}{" "}
                · données synthétiques uniquement
              </p>
              <small>Expiration : {timestamp(preview.expiresAt)}</small>
              {overview.usage
                .filter((item) => item.environmentId === preview.environmentId)
                .map((item) => (
                  <UsageNote key={item.runId} usage={item} />
                ))}
              {preview.state === "active" &&
              preview.url &&
              safePreviewUrl(preview.url) &&
              Date.parse(preview.expiresAt) > now ? (
                <p>
                  <a href={preview.url} target="_blank" rel="noreferrer">
                    Ouvrir la preview vérifiée
                  </a>
                </p>
              ) : (
                <p className="muted">Aucune URL active vérifiée.</p>
              )}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
