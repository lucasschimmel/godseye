import type {
  CodingPreparationView,
  OrchestrationDetailView,
  ProjectDTO,
} from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { resource, timestamp } from "@/lib/api";
import { AgentsAction } from "./agents-action";
import { AGENT_REFRESH_MS, type AgentPost, agentMoney } from "./agents-labels";
import { AgentsPlansAnswer } from "./agents-plans-answer";
import { AgentsPlansEvidence } from "./agents-plans-evidence";
import { Failure, Loading } from "./shared";
import { Button } from "./ui/button";

export const planStateLabels: Record<OrchestrationDetailView["state"], string> = {
  pending: "À approuver",
  approved: "Approuvé",
  running: "En cours",
  waiting_clarification: "Réponse attendue",
  succeeded: "Terminé",
  failed: "Échec",
  unknown: "Résultat incertain",
  cancel_requested: "Arrêt demandé",
  cancelled: "Annulé",
  rejected: "Rejeté",
  expired: "Expiré",
};
const childStateLabels = {
  pending: "En attente",
  intended: "Admission préparée",
  running: "En cours",
  succeeded: "Terminée",
  failed: "Échec",
  unknown: "Résultat incertain",
  cancelled: "Annulée",
  waiting_clarification: "Réponse attendue",
} as const;
const kindLabels = {
  hermes: "Hermès",
  coding: "Code isolé",
  clarification: "Clarification propriétaire",
} as const;

// The server's immutable detail is the approval surface; current mutable profile settings are not substituted.
export function AgentsPlansDetail({
  id,
  projects,
  preparations,
  disabled,
  fresh,
  post,
  select,
  selectTask,
}: {
  id: string;
  projects: ProjectDTO[];
  preparations: CodingPreparationView[];
  disabled: boolean;
  fresh: boolean;
  post: AgentPost;
  select: (id: string) => void;
  selectTask: (id: string) => void;
}) {
  const query = useQuery({
    ...resource<OrchestrationDetailView>(
      `orchestration-plan-${id}`,
      `/agents/orchestration/plans/${id}`,
    ),
    refetchInterval: AGENT_REFRESH_MS,
  });
  if (!query.data)
    return query.isError ? (
      <Failure error={query.error} retry={() => void query.refetch()} />
    ) : (
      <Loading />
    );
  const detail = query.data;
  const { plan } = detail;
  const project = projects.find((row) => row.id === plan.projectId);
  const environment = project?.environments.find((row) => row.id === plan.environmentId);
  const changedScope =
    project?.revision !== plan.expectedProjectRevision ||
    environment?.revision !== plan.expectedEnvironmentRevision;
  const expired = Date.parse(plan.expiresAt) <= Date.now();
  const blocked = disabled || query.isError;
  const canStop = [
    "pending",
    "approved",
    "running",
    "waiting_clarification",
    "unknown",
    "cancel_requested",
  ].includes(detail.state);
  return (
    <article className="agents-plans-detail" aria-label="Contenu exact du plan">
      <div className="agents-profile-top">
        <h3>{plan.title}</h3>
        <span className="agents-badge agents-attention">{planStateLabels[detail.state]}</span>
      </div>
      {query.isError && <Failure error={query.error} retry={() => void query.refetch()} />}
      {changedScope && (
        <p className="agents-notice" role="alert">
          Le périmètre actuel diffère du plan figé. L’approbation est bloquée ; préparez un nouveau
          plan.
        </p>
      )}
      {expired && (
        <p className="agents-notice">
          Le délai est écoulé. Aucune nouvelle admission n’est autorisée ; la vérification des
          résultats reste possible.
        </p>
      )}
      <dl className="agents-meta agents-plans-meta">
        <div>
          <dt>Projet</dt>
          <dd>
            {project?.name ?? "Projet indisponible"} · {plan.projectId} · révision{" "}
            {plan.expectedProjectRevision}
          </dd>
        </div>
        <div>
          <dt>Environnement</dt>
          <dd>
            {environment?.name ?? "Environnement indisponible"} · {plan.environmentId} · révision{" "}
            {plan.expectedEnvironmentRevision}
          </dd>
        </div>
        <div>
          <dt>Plan</dt>
          <dd>{plan.id}</dd>
        </div>
        <div>
          <dt>Empreinte exacte</dt>
          <dd>{plan.hash}</dd>
        </div>
        <div>
          <dt>Époque</dt>
          <dd>{plan.epoch}</dd>
        </div>
        <div>
          <dt>Budget maximal</dt>
          <dd>
            {agentMoney(plan.maxCostMicros)} · somme des étapes :{" "}
            {agentMoney(plan.steps.reduce((sum, row) => sum + row.maxCostMicros, 0))} · plafond
            exact : {plan.maxCostMicros} micro-USD
          </dd>
        </div>
        <div>
          <dt>Préparé le</dt>
          <dd>
            <time dateTime={plan.createdAt}>{timestamp(plan.createdAt)}</time>
          </dd>
        </div>
        <div>
          <dt>Échéance exacte</dt>
          <dd>
            <time dateTime={plan.expiresAt}>{plan.expiresAt}</time>
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>
            {plan.sourceTaskId ? (
              <>
                <span>Tâche Hermès {plan.sourceTaskId}</span>
                <Button variant="outline" onClick={() => selectTask(plan.sourceTaskId ?? "")}>
                  Voir la tâche source
                </Button>
              </>
            ) : (
              "Composition propriétaire"
            )}
          </dd>
        </div>
        <div>
          <dt>Continuation de</dt>
          <dd>
            {plan.supersedesId ? (
              <Button variant="outline" onClick={() => select(plan.supersedesId ?? "")}>
                {plan.supersedesId}
              </Button>
            ) : (
              "Plan initial"
            )}
          </dd>
        </div>
        <div>
          <dt>Approbation</dt>
          <dd>
            {detail.approvedAt
              ? `${timestamp(detail.approvedAt)} · ${detail.approvedBy ?? "propriétaire"}`
              : "Aucune"}
          </dd>
        </div>
        <div>
          <dt>Suivi actualisé</dt>
          <dd>{timestamp(detail.updatedAt)}</dd>
        </div>
      </dl>
      {detail.reason && <p className="agents-notice">Raison : {detail.reason}</p>}
      <h4>Étapes, liaisons et limites figées</h4>
      <ol className="agents-plans-steps">
        {plan.steps.map((frozen) => {
          const step = frozen.step;
          const child = detail.children.find((row) => row.stepId === step.id);
          const preparation =
            step.kind === "coding"
              ? preparations.find(
                  (row) => row.id === step.preparationId && row.hash === step.expectedHash,
                )
              : undefined;
          return (
            <li key={step.id} className="agents-plans-step">
              <div className="agents-profile-top">
                <h4>
                  {step.id} · {kindLabels[step.kind]}
                </h4>
                <span className="agents-badge">
                  {child ? childStateLabels[child.state] : "Aucune tâche créée"}
                </span>
              </div>
              <p>Dépendances : {step.dependsOn.length ? step.dependsOn.join(", ") : "aucune"}</p>
              <p>
                Plafond : {agentMoney(frozen.maxCostMicros)} ({frozen.maxCostMicros} micro-USD) ·
                durée maximale : {frozen.timeoutSeconds} s
              </p>
              <p>
                Liaison figée : <code>{frozen.bindingHash ?? "Aucune liaison d’exécution"}</code>
              </p>
              {step.kind === "hermes" && (
                <>
                  <p>
                    Profil <code>{step.profileId}</code> · révision {step.expectedRevision}
                  </p>
                  <p>
                    Résultats des dépendances directes :{" "}
                    {step.includeDependencyOutputs
                      ? "joints comme données citées, sans droits supplémentaires"
                      : "non joints"}
                    .
                  </p>
                  <p className="agents-text">{step.input}</p>
                </>
              )}
              {step.kind === "coding" && (
                <>
                  <p>
                    Préparation <code>{step.preparationId}</code>
                  </p>
                  <p>
                    Empreinte attendue : <code>{step.expectedHash}</code>
                  </p>
                  {preparation && (
                    <>
                      <p>
                        {preparation.runner} · {preparation.repository.fullName} · commit{" "}
                        <code>{preparation.commitSha}</code>
                      </p>
                      <p className="agents-text">{preparation.input}</p>
                      <p>
                        Vérification : {preparation.testProfile} · patch{" "}
                        {preparation.limits.maxPatchBytes} octets · sortie{" "}
                        {preparation.limits.maxOutputBytes} octets
                      </p>
                    </>
                  )}
                </>
              )}
              {step.kind === "clarification" && (
                <>
                  <p className="agents-text">{step.question}</p>
                  {step.answer && <p className="agents-text">Réponse retenue : {step.answer}</p>}
                  {detail.state === "waiting_clarification" &&
                    child?.state === "waiting_clarification" &&
                    !step.answer && (
                      <AgentsPlansAnswer
                        key={`${plan.id}:${step.id}`}
                        planId={plan.id}
                        hash={plan.hash}
                        stepId={step.id}
                        disabled={blocked || expired}
                        post={post}
                        select={select}
                      />
                    )}
                </>
              )}
              {child?.reason && <p className="agents-notice">{child.reason}</p>}
              {child?.taskId && (
                <AgentsPlansEvidence
                  kind={child.kind}
                  taskId={child.taskId}
                  selectTask={selectTask}
                />
              )}
            </li>
          );
        })}
      </ol>
      {detail.state === "pending" && (
        <>
          <p className="agents-notice">
            Approuver autorise uniquement ces étapes, ces liaisons, ce budget et ce délai. Une clé
            d’accès confirmée récemment est nécessaire.
          </p>
          <div className="agents-actions">
            <AgentsAction
              label="Approuver ce plan exact"
              path={`/agents/orchestration/plans/${id}/approve`}
              body={{ expectedHash: plan.hash }}
              disabled={blocked || !fresh || expired || changedScope}
              post={post}
            />
            <AgentsAction
              label="Rejeter ce plan"
              path={`/agents/orchestration/plans/${id}/reject`}
              body={{ expectedHash: plan.hash }}
              disabled={blocked}
              post={post}
            />
          </div>
          {!fresh && (
            <p className="muted">
              Utilisez « Confirmer mon identité » en haut de la page pour approuver.
            </p>
          )}
        </>
      )}
      {detail.state === "unknown" && (
        <p className="agents-notice">
          Un résultat incertain bloque les étapes dépendantes. Vérifier ne relance aucune tâche.
        </p>
      )}
      <div className="agents-actions">
        {canStop && (
          <AgentsAction
            label="Demander l’arrêt du plan"
            path={`/agents/orchestration/plans/${id}/cancel`}
            body={{}}
            disabled={blocked}
            post={post}
          />
        )}
        <AgentsAction
          label="Réconcilier le plan sans relancer"
          path={`/agents/orchestration/plans/${id}/reconcile`}
          body={{}}
          disabled={blocked}
          post={post}
        />
      </div>
      <p className="muted">
        L’arrêt et la réconciliation ne nécessitent pas de nouvelle confirmation d’identité. Une
        demande d’arrêt conserve les preuves et l’incertitude physique jusqu’à vérification.
      </p>
    </article>
  );
}
