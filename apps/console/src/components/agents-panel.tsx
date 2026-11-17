import type { AgentOverviewView, OrchestrationOverviewView, ProjectDTO } from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { api, isStepUpRequired, resource } from "@/lib/api";
import { runtimeHeading } from "@/lib/deployment";
import { confirmIdentity, MANUAL_STEP_UP } from "@/lib/step-up";
import { useDeployment } from "@/lib/use-deployment";
import { AgentsChat } from "./agents-chat";
import { AgentsCoding } from "./agents-coding";
import { AGENT_REFRESH_MS, type AgentPost } from "./agents-labels";
import { AgentsPlans } from "./agents-plans";
import { AgentsProfileForm } from "./agents-profile-form";
import { AgentsProfiles } from "./agents-profiles";
import { AgentsTaskForm } from "./agents-task-form";
import { AgentsTaskHistory } from "./agents-task-history";
import { HermesMark, StatusPill } from "./ds/viz";
import { Failure, Loading } from "./shared";
import { Button } from "./ui/button";

export const HERMES_VIEWS = {
  conversations: "Conversations",
  plans: "Plans",
  taches: "Tâches",
  code: "Code",
  profils: "Profils",
} as const;
export type HermesView = keyof typeof HERMES_VIEWS;

const ACTIVE_TASKS = new Set(["queued", "running", "cancel_requested"]);

/**
 * Hermes workspace. One shared, idempotent `post` serves every view; a refused sensitive action
 * opens the passkey sheet and is retried once with the same idempotency key.
 */
export function AgentsPanel({ view }: { view: HermesView }) {
  const overview = useQuery({
    ...resource<AgentOverviewView>("agents", "/agents"),
    refetchInterval: AGENT_REFRESH_MS,
  });
  const projects = useQuery({
    ...resource<ProjectDTO[]>("projects", "/projects"),
    refetchInterval: AGENT_REFRESH_MS,
  });
  const plans = useQuery({
    ...resource<OrchestrationOverviewView>("orchestration", "/agents/orchestration"),
    refetchInterval: AGENT_REFRESH_MS,
  });
  const cache = useQueryClient();
  const deployment = useDeployment();
  const intents = useRef(new Map<string, string>());
  const [selectedTask, setSelectedTask] = useState("");
  const mutation = useMutation({
    meta: MANUAL_STEP_UP,
    mutationFn: async ({
      path,
      body,
      method,
    }: {
      path: string;
      body: unknown;
      method: "POST" | "PUT";
    }) => {
      const input = JSON.stringify(body);
      const identity = `${method}:${path}:${input}`;
      const key = intents.current.get(identity) ?? crypto.randomUUID();
      // Retain a lost response's key so an unchanged intention cannot create another task.
      if (intents.current.size >= 32 && !intents.current.has(identity))
        throw new Error(
          "Trop de demandes non confirmées. Actualisez les états avant de continuer.",
        );
      intents.current.set(identity, key);
      const value = await api<unknown>(path, {
        method,
        body: input,
        headers: { "idempotency-key": key },
      });
      intents.current.delete(identity);
      return value;
    },
    retry: false,
    onSuccess: async () => {
      await cache.invalidateQueries();
    },
  });
  if (!overview.data)
    return overview.isError ? (
      <div className="hermes-pad">
        <Failure error={overview.error} retry={() => void overview.refetch()} />
      </div>
    ) : (
      <Loading />
    );
  if (!projects.data)
    return projects.isError ? (
      <div className="hermes-pad">
        <Failure error={projects.error} retry={() => void projects.refetch()} />
      </div>
    ) : (
      <Loading />
    );
  const data = overview.data;
  const stale = overview.isError || projects.isError;
  const disabled = mutation.isPending || stale;
  const post: AgentPost = async (path, body, method = "POST") => {
    try {
      return await mutation.mutateAsync({ path, body, method });
    } catch (error) {
      if (!isStepUpRequired(error)) throw error;
      const confirmed = await confirmIdentity(
        "Confirmer l’action Hermes",
        "Créer, reconfigurer, lancer ou approuver exige une confirmation récente.",
      );
      if (!confirmed) throw error;
      return mutation.mutateAsync({ path, body, method });
    }
  };
  const available = data.status === "available";
  const running = data.tasks.filter((task) => ACTIVE_TASKS.has(task.state)).length;
  const pendingPlans = (plans.data?.plans ?? []).filter(
    (plan) => plan.state === "pending" || plan.state === "waiting_clarification",
  ).length;
  const counts: Partial<Record<HermesView, number>> = {
    plans: pendingPlans,
    taches: running,
    profils: data.profiles.length,
  };
  return (
    <div className={`hermes view-${view}`}>
      <header className="hermes-bar">
        <div className="hermes-title">
          <HermesMark size={30} />
          <div>
            <h1>Hermes</h1>
            <span className="faint small">
              {runtimeHeading(available, deployment.isLocal)} ·{" "}
              {data.tools.length
                ? `${data.tools.length} outils isolés disponibles`
                : "outils isolés indisponibles"}
            </span>
          </div>
          <StatusPill tone={available ? "ok" : "decl"}>
            {available ? "Configuré" : "Non configuré"}
          </StatusPill>
        </div>
        <nav className="seg" aria-label="Vues Hermes">
          {(Object.keys(HERMES_VIEWS) as HermesView[]).map((key) => (
            <Link
              key={key}
              to="/hermes"
              search={{ vue: key }}
              aria-current={view === key ? "page" : undefined}
            >
              {HERMES_VIEWS[key]}
              {counts[key] ? (
                <span className={`seg-count ${key === "plans" ? "signal" : ""}`}>
                  {counts[key]}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Actualiser Hermes"
          disabled={overview.isFetching}
          onClick={() =>
            void Promise.all([overview.refetch(), projects.refetch(), plans.refetch()])
          }
        >
          <RefreshCw className={overview.isFetching ? "spin" : ""} />
        </Button>
      </header>
      {stale && (
        <p className="agents-notice hermes-notice" role="alert">
          Actualisation échouée : les données peuvent être périmées. Actualisez avant une nouvelle
          action.
        </p>
      )}
      {mutation.isError && !isStepUpRequired(mutation.error) && (
        <div className="hermes-notice">
          <Failure error={mutation.error} />
        </div>
      )}
      {!available && view !== "profils" && (
        <p className="callout hermes-notice">
          <span>
            <b>Runtime non connecté.</b> Les profils se configurent ; les lancements restent bloqués
            jusqu’à la connexion d’un runtime autorisé pour leur périmètre.
          </span>
        </p>
      )}
      {view === "conversations" && data.profiles.length === 0 && (
        <p className="callout hermes-notice">
          <span>
            <b>Aucun profil Hermes.</b> Une conversation s’ouvre toujours dans le périmètre d’un
            profil lié à un projet et à un environnement.
          </span>
          <Link className="link" to="/hermes" search={{ vue: "profils" }}>
            Créer un profil
          </Link>
        </p>
      )}
      {view === "conversations" && (
        <AgentsChat
          profiles={data.profiles}
          projects={projects.data}
          post={post}
          disabled={disabled}
          fresh
          toolsAvailable={data.tools.length > 0}
        />
      )}
      {view === "plans" && (
        <div className="hermes-pad">
          <AgentsPlans
            projects={projects.data}
            overview={data}
            post={post}
            disabled={disabled}
            fresh
            selectTask={(id) => setSelectedTask(id)}
          />
        </div>
      )}
      {view === "taches" && (
        <div className="hermes-pad">
          <p className="faint small hermes-scope-note">
            Une tâche = une réservation bornée dans le périmètre de son profil. Les outils Hermes ne
            donnent pas accès aux commandes système ni aux builds ; le code passe par la vue Code.
          </p>
          <AgentsTaskForm
            overview={data}
            projects={projects.data}
            disabled={disabled}
            post={post}
            selectTask={setSelectedTask}
          />
          <div id="agents-task-history">
            <AgentsTaskHistory
              overview={data}
              projects={projects.data}
              selectedId={selectedTask}
              selectTask={setSelectedTask}
              disabled={disabled}
              post={post}
            />
          </div>
        </div>
      )}
      {view === "code" && (
        <div className="hermes-pad">
          <AgentsCoding projects={projects.data} post={post} disabled={disabled} fresh />
        </div>
      )}
      {view === "profils" && (
        <div className="hermes-pad">
          <AgentsProfiles
            overview={data}
            projects={projects.data}
            disabled={disabled}
            post={post}
            selectTask={setSelectedTask}
          />
          <AgentsProfileForm
            overview={data}
            projects={projects.data}
            disabled={disabled}
            post={post}
          />
        </div>
      )}
    </div>
  );
}
