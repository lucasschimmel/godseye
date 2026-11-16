import {
  type AgentOverviewView,
  AgentTask,
  LaunchAgentTask,
  type ProjectDTO,
} from "@godseye/contracts";
import { useState } from "react";
import { AgentsBudget } from "./agents-budget";
import {
  type AgentPost,
  agentEnvironments,
  agentMoney,
  agentProfileScope,
  agentRoleLabels,
} from "./agents-labels";
import { AgentsToolsFields, toolGrantFromForm } from "./agents-tools-fields";
import { Button } from "./ui/button";

export function AgentsTaskForm({
  overview,
  projects,
  disabled,
  post,
  selectTask,
}: {
  overview: AgentOverviewView;
  projects: ProjectDTO[];
  disabled: boolean;
  post: AgentPost;
  selectTask: (id: string) => void;
}) {
  const [profileId, setProfileId] = useState("");
  const [problem, setProblem] = useState("");
  const [selectionReset, setSelectionReset] = useState(0);
  const [draft, setDraft] = useState("");
  const [intention, setIntention] = useState<
    import("@godseye/contracts").LaunchAgentTaskInput | null
  >(null);
  const profile = overview.profiles.find((row) => row.id === profileId) ?? overview.profiles[0];
  if (!profile) return null;
  const retrying = intention?.profileId === profile.id && intention.input === draft;
  const { project, environment } = agentProfileScope(profile, projects);
  const stale =
    project?.revision !== profile.projectRevision ||
    environment?.revision !== profile.environmentRevision;
  const held =
    !project ||
    !environment ||
    !agentEnvironments(project).some((row) => row.id === environment.id);
  const busy = profile.busy;
  const block = profile.paused
    ? "Ce profil est en pause."
    : held
      ? "Cet environnement n’est pas admissible."
      : stale
        ? "Le périmètre a changé : reconfigurez le profil."
        : busy
          ? "Une tâche en cours ou incertaine conserve ce profil."
          : profile.runtime !== "available"
            ? "Connectez le runtime local de ce profil avant de lancer une tâche."
            : "";
  return (
    <section className="panel agents-form" aria-label="Lancement Hermès">
      <h2>Nouvelle tâche</h2>
      <p className="muted">
        Demandez une analyse ou un brouillon. Les outils ne reçoivent que les fichiers texte copiés
        pour cette tâche.
      </p>
      <label htmlFor="agent-task-profile">
        Profil de la tâche
        <select
          id="agent-task-profile"
          value={profile.id}
          onChange={(event) => {
            setProfileId(event.target.value);
            setProblem("");
          }}
          disabled={disabled}
        >
          {overview.profiles.map((row) => (
            <option key={row.id} value={row.id}>
              {agentRoleLabels[row.role]} · {agentProfileScope(row, projects).label}
            </option>
          ))}
        </select>
      </label>
      <p className="agents-scope">
        <span>{profile.model}</span>
        <span>{profile.limits.maxOutputTokens} tokens maximum</span>
        <span>{agentMoney(profile.limits.maxCostMicros)} réservés au maximum</span>
      </p>
      {block && (
        <p className="agents-notice" role="status">
          {block}
        </p>
      )}
      <form
        key={`${profile.id}:${profile.revision}`}
        aria-label="Nouvelle tâche Hermès"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          let toolGrant: ReturnType<typeof toolGrantFromForm>;
          try {
            toolGrant = retrying ? intention?.toolGrant : toolGrantFromForm(data);
          } catch {
            setProblem("Vérifiez les droits, plafonds et fichier copié de cette tâche.");
            return;
          }
          const parsed = LaunchAgentTask.safeParse(
            retrying
              ? intention
              : {
                  profileId: profile.id,
                  expectedRevision: profile.revision,
                  input: draft,
                  ...(toolGrant ? { toolGrant } : {}),
                },
          );
          if (!parsed.success || new TextEncoder().encode(parsed.data.input).byteLength > 8192) {
            setProblem("La demande doit contenir entre 1 et 8 192 octets de texte.");
            return;
          }
          try {
            const body = structuredClone(parsed.data);
            setIntention(body);
            const task = AgentTask.parse(await post("/agents/tasks", body));
            setProblem("");
            selectTask(task.id);
            form.reset();
            setDraft("");
            setIntention(null);
            setSelectionReset((value) => value + 1);
          } catch {
            setProblem(
              "Le lancement n’est pas confirmé. Vérifiez l’historique avant de créer une autre demande ; réessayer à l’identique conserve la même intention.",
            );
          }
        }}
      >
        <label htmlFor="agent-task-input">
          Demande à Hermès
          <textarea
            id="agent-task-input"
            name="input"
            required
            maxLength={8192}
            rows={5}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={disabled || (!!block && !retrying)}
            placeholder="Exemple : propose une liste de vérifications pour la prochaine mise en ligne."
          />
        </label>
        <p className="muted">
          N’incluez pas de clé API ni de données sensibles inutiles. L’historique est privé et lié à
          cet environnement.
        </p>
        <AgentsToolsFields
          key={`${profile.id}:${profile.revision}:${selectionReset}`}
          profile={profile}
          mode="task"
          disabled={disabled || !!block || retrying}
          available={overview.tools.length > 0}
        />
        <Button className="agents-submit" disabled={disabled || (!!block && !retrying)}>
          {retrying ? "Vérifier le lancement" : "Lancer la tâche"}
        </Button>
      </form>
      {problem && (
        <p className="agents-problem" role="alert">
          {problem}
        </p>
      )}
      <AgentsBudget
        key={profile.projectId}
        projectId={profile.projectId}
        disabled={disabled}
        post={post}
      />
    </section>
  );
}
