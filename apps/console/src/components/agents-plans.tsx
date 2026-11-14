import {
  type AgentOverviewView,
  type CodingOverviewView,
  OrchestrationDetail,
  type OrchestrationOverviewView,
  type ProjectDTO,
} from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { resource, timestamp } from "@/lib/api";
import { AGENT_REFRESH_MS, type AgentPost } from "./agents-labels";
import { AgentsPlansComposer } from "./agents-plans-composer";
import { AgentsPlansDetail, planStateLabels } from "./agents-plans-detail";
import { Failure, Loading } from "./shared";
import { Button } from "./ui/button";

export function AgentsPlans({
  projects,
  overview,
  disabled,
  fresh,
  post,
  selectTask,
}: {
  projects: ProjectDTO[];
  overview: AgentOverviewView;
  disabled: boolean;
  fresh: boolean;
  post: AgentPost;
  selectTask: (id: string) => void;
}) {
  const query = useQuery({
    ...resource<OrchestrationOverviewView>("orchestration", "/agents/orchestration"),
    refetchInterval: AGENT_REFRESH_MS,
  });
  const coding = useQuery({
    ...resource<CodingOverviewView>("coding", "/agents/coding"),
    refetchInterval: AGENT_REFRESH_MS,
  });
  const [selectedId, setSelectedId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [problem, setProblem] = useState("");
  if (!query.data)
    return query.isError ? (
      <Failure error={query.error} retry={() => void query.refetch()} />
    ) : (
      <Loading />
    );
  const blocked = disabled || query.isError;
  const plans = [...query.data.plans].sort(
    (a, b) =>
      Number(b.state === "pending") - Number(a.state === "pending") ||
      b.plan.createdAt.localeCompare(a.plan.createdAt),
  );
  const selected = selectedId || plans[0]?.plan.id;
  const preparations =
    coding.data?.preparations.filter(
      (row) => !coding.data?.tasks.some((task) => task.preparationId === row.id),
    ) ?? [];
  const sources = overview.tasks.filter((task) => task.state === "succeeded" && task.output);
  return (
    <section className="panel agents-plans" aria-label="Plans orchestrés">
      <div className="agents-runtime-heading">
        <div>
          <p className="eyebrow">ORCHESTRATION · LOCAL</p>
          <h2>Plans soumis au propriétaire</h2>
        </div>
        <span className="agents-badge agents-attention">
          {plans.filter((row) => row.state === "pending").length} à approuver
        </span>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void Promise.all([query.refetch(), coding.refetch()])}
        >
          Actualiser les plans
        </Button>
      </div>
      <p className="muted">
        Reliez des tâches Hermès, des préparations de code et des questions de clarification. Les
        dépendances attendent une réussite confirmée. Chaque plan et chaque continuation requièrent
        leur propre approbation exacte.
      </p>
      {query.isError && (
        <p className="agents-notice" role="alert">
          Le suivi des plans n’a pas été actualisé. Les données affichées peuvent être périmées ;
          les actions sont bloquées.
        </p>
      )}
      {coding.isError && (
        <p className="agents-notice" role="alert">
          Les préparations de code n’ont pas pu être actualisées. Actualisez avant de composer un
          nouveau plan.
        </p>
      )}
      {!coding.data && !coding.isError && <p role="status">Chargement des préparations de code…</p>}
      <AgentsPlansComposer
        projects={projects}
        profiles={overview.profiles}
        preparations={preparations}
        disabled={blocked || coding.isError || !coding.data}
        post={post}
        select={setSelectedId}
      />
      <details className="agents-plans-import">
        <summary>Importer une proposition issue d’une tâche Hermès</summary>
        <form
          className="agents-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setProblem("");
            try {
              const detail = OrchestrationDetail.parse(
                await post("/agents/orchestration/proposals", { taskId: sourceId }),
              );
              setSelectedId(detail.plan.id);
            } catch (error) {
              setProblem(
                error instanceof Error ? error.message : "La proposition n’a pas été importée.",
              );
            }
          }}
        >
          <label>
            Tâche source réussie
            <select
              required
              disabled={blocked}
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
            >
              <option value="">Choisir une tâche réussie</option>
              {sources.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.input.slice(0, 90)} · {timestamp(task.finishedAt ?? task.updatedAt)}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Seule une proposition structurée valide, issue d’une tâche réussie dans son périmètre
            actuel, peut être importée. Son texte reste non fiable et ne donne aucun droit
            d’exécution.
          </p>
          <Button type="submit" disabled={blocked || !sourceId}>
            Importer pour relecture
          </Button>
          {!sources.length && <p>Aucune tâche réussie avec résultat disponible.</p>}
          {problem && (
            <p className="agents-problem" role="alert">
              {problem}
            </p>
          )}
        </form>
      </details>
      {!plans.length && !selected ? (
        <p className="agents-notice">
          Aucun plan. Composez une première demande ; aucune étape ne démarre pendant sa
          préparation.
        </p>
      ) : (
        <div className="agents-plans-history">
          <nav className="agents-plans-list" aria-label="Choisir un plan">
            {plans.map((detail) => (
              <button
                type="button"
                key={detail.plan.id}
                className="agents-task-pick"
                aria-pressed={selected === detail.plan.id}
                onClick={() => setSelectedId(detail.plan.id)}
              >
                <span className="agents-badge">{planStateLabels[detail.state]}</span>
                <strong>{detail.plan.title}</strong>
                <span>
                  {detail.plan.steps.length} étape(s) · {timestamp(detail.plan.createdAt)}
                </span>
              </button>
            ))}
          </nav>
          {selected && (
            <AgentsPlansDetail
              key={selected}
              id={selected}
              projects={projects}
              preparations={coding.data?.preparations ?? []}
              disabled={blocked}
              fresh={fresh}
              post={post}
              select={setSelectedId}
              selectTask={selectTask}
            />
          )}
        </div>
      )}
      <p className="muted">
        Les 100 plans les plus récents sont affichés. L’approbation native globale d’Hermès n’est
        jamais accordée. Aucun plan ne publie ni ne déploie une application.
      </p>
    </section>
  );
}
