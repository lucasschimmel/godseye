import type { AgentOverviewView, AgentTaskDetail, ProjectDTO } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { resource, timestamp } from "@/lib/api";
import { AgentsAction } from "./agents-action";
import {
  AGENT_REFRESH_MS,
  type AgentPost,
  agentRoleLabels,
  agentStateLabels,
} from "./agents-labels";
import { AgentsToolsHistory } from "./agents-tools-history";
import { EmptyState, Failure, SectionTitle } from "./shared";

export function AgentsTaskHistory({
  overview,
  projects,
  selectedId,
  selectTask,
  disabled,
  post,
}: {
  overview: AgentOverviewView;
  projects: ProjectDTO[];
  selectedId: string;
  selectTask: (id: string) => void;
  disabled: boolean;
  post: AgentPost;
}) {
  const selected = selectedId || overview.tasks[0]?.id;
  return (
    <section className="panel agents-history" aria-label="Historique des tâches Hermès">
      <SectionTitle count={overview.tasks.length}>Tâches Hermès</SectionTitle>
      {!selected ? (
        <EmptyState
          title="Aucune tâche lancée"
          description="Les états, demandes et résultats apparaîtront ici. Un résultat incertain sera conservé jusqu’à sa vérification."
        />
      ) : (
        <div className="agents-history-grid">
          <fieldset className="agents-task-list" aria-label="Choisir une tâche">
            {overview.tasks.map((task) => {
              const profile = overview.profiles.find((row) => row.id === task.profileId);
              const project = projects.find((row) => row.id === task.projectId);
              const environment = project?.environments.find(
                (row) => row.id === task.environmentId,
              );
              return (
                <button
                  key={task.id}
                  type="button"
                  className="agents-task-pick"
                  aria-pressed={selected === task.id}
                  onClick={() => selectTask(task.id)}
                  aria-label={`Voir la tâche ${task.input.slice(0, 70)}`}
                >
                  <span className={`agents-badge agents-task-${task.state}`}>
                    {agentStateLabels[task.state]}
                  </span>
                  <strong>{task.input.slice(0, 120)}</strong>
                  <span>
                    {profile ? agentRoleLabels[profile.role] : "Profil conservé"} ·{" "}
                    {project?.name ?? "Projet indisponible"} ·{" "}
                    {environment?.name ?? "Environnement indisponible"}
                  </span>
                  <time dateTime={task.createdAt}>{timestamp(task.createdAt)}</time>
                </button>
              );
            })}
          </fieldset>
          <TaskDetail key={selected} id={selected} disabled={disabled} post={post} />
        </div>
      )}
      <p className="agents-history-note">
        Les 100 tâches les plus récentes sont affichées. Une demande acceptée reste distincte d’une
        tâche terminée.
      </p>
    </section>
  );
}

function TaskDetail({ id, disabled, post }: { id: string; disabled: boolean; post: AgentPost }) {
  const detail = useQuery({
    ...resource<z.infer<typeof AgentTaskDetail>>(`agent-task-${id}`, `/agents/tasks/${id}`),
    refetchInterval: AGENT_REFRESH_MS,
  });
  if (!detail.data)
    return detail.isError ? (
      <Failure error={detail.error} retry={() => void detail.refetch()} />
    ) : (
      <p role="status">Chargement de la tâche…</p>
    );
  const { task, events } = detail.data;
  const canCancel = ["queued", "running", "unknown", "reconciling", "cancel_requested"].includes(
    task.state,
  );
  const uncertain = ["unknown", "reconciling", "cancel_requested"].includes(task.state);
  return (
    <article className="agents-task-detail" aria-label="Détail de la tâche Hermès">
      <div className="agents-profile-top">
        <h3>Détail de la tâche</h3>
        <span className={`agents-badge agents-task-${task.state}`}>
          {agentStateLabels[task.state]}
        </span>
      </div>
      {detail.isError && (
        <p className="agents-problem" role="alert">
          Le suivi n’a pas été actualisé. L’état affiché peut être périmé.
        </p>
      )}
      <p className="mono">{task.id}</p>
      <h4>Demande</h4>
      <p className="agents-text">{task.input}</p>
      <h4>Résultat</h4>
      <p className="agents-text" role={task.output ? undefined : "status"}>
        {task.output ??
          (uncertain
            ? "Résultat non confirmé. Vérifiez l’exécution avant toute nouvelle demande."
            : "Aucun résultat disponible pour le moment.")}
      </p>
      {task.reason && <p className="agents-notice">Raison : {task.reason}</p>}
      <p className="muted">
        Entrée : {task.usage.inputTokens ?? "inconnue"} tokens · Sortie :{" "}
        {task.usage.outputTokens ?? "inconnue"} tokens. La réservation est conservatrice ; le coût
        facturé reste à rapprocher.
      </p>
      <div className="agents-actions">
        {canCancel && (
          <AgentsAction
            label="Demander l’arrêt"
            path={`/agents/tasks/${id}/cancel`}
            body={{}}
            disabled={disabled}
            post={post}
          />
        )}
        {uncertain && (
          <AgentsAction
            label="Vérifier le résultat"
            path={`/agents/tasks/${id}/reconcile`}
            body={{}}
            disabled={disabled}
            post={post}
          />
        )}
      </div>
      {task.state === "cancel_requested" && (
        <p className="agents-notice">
          L’arrêt a été demandé. Le profil et le budget restent réservés jusqu’à confirmation.
        </p>
      )}
      <h4>Journal d’état</h4>
      {task.toolGrant && <AgentsToolsHistory taskId={task.id} />}
      <ol className="agents-timeline">
        {events.map((event) => (
          <li key={event.id}>
            <span>{agentStateLabels[event.state]}</span>
            <time dateTime={event.occurredAt}>{timestamp(event.occurredAt)}</time>
          </li>
        ))}
      </ol>
    </article>
  );
}
