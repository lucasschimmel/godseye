import {
  AgentLimits,
  type AgentOverviewView,
  type AgentProfileView,
  ConfigureAgentProfile,
  CreateAgentProfile,
  type ProjectDTO,
} from "@godseye/contracts";
import { useState } from "react";
import { environmentLabel } from "@/lib/environment-labels";
import { type AgentPost, agentEnvironments, agentRoleLabels } from "./agents-labels";
import { AgentsToolsFields, toolPolicyFromForm } from "./agents-tools-fields";
import { EmptyState } from "./shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function AgentsProfileForm({
  overview,
  projects,
  disabled,
  post,
  profile,
}: {
  overview: AgentOverviewView;
  projects: ProjectDTO[];
  disabled: boolean;
  post: AgentPost;
  profile?: AgentProfileView;
}) {
  const [projectId, setProjectId] = useState(profile?.projectId ?? "");
  const [environmentId, setEnvironmentId] = useState(profile?.environmentId ?? "");
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(false);
  const candidates = projects.filter((row) => agentEnvironments(row).length > 0);
  const project =
    candidates.find((row) => row.id === projectId) ?? (profile ? undefined : candidates[0]);
  const environments = project ? agentEnvironments(project) : [];
  const environment =
    environments.find((row) => row.id === environmentId) ?? (profile ? undefined : environments[0]);
  if (!project || !environment)
    return (
      <EmptyState
        title="Aucun environnement admissible"
        description="Créez un projet ou levez sa suspension. Les environnements de restauration, expirés ou protégés ne peuvent pas recevoir de profil actif."
      />
    );
  const defaults = profile?.limits ?? overview.defaults;
  const prefix = profile?.id ?? "new-agent";
  return (
    <section
      className="panel agents-form"
      aria-label={profile ? "Configuration du profil" : "Nouveau profil Hermès"}
    >
      <h2>{profile ? "Reconfigurer le profil" : "Nouveau profil Hermès"}</h2>
      <p className="muted">
        Un rôle, un projet et un environnement. Seul le skill de contexte versionné est chargé ; les
        outils de fichiers demandent une autorisation explicite du propriétaire.
      </p>
      <div className="agents-fields">
        <label htmlFor={`${prefix}-project`}>
          Projet du profil
          <select
            id={`${prefix}-project`}
            value={project.id}
            disabled={disabled || !!profile}
            onChange={(event) => {
              setProjectId(event.target.value);
              setEnvironmentId("");
              setSaved(false);
            }}
          >
            {candidates.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${prefix}-environment`}>
          Environnement du profil
          <select
            id={`${prefix}-environment`}
            value={environment.id}
            disabled={disabled || !!profile}
            onChange={(event) => {
              setEnvironmentId(event.target.value);
              setSaved(false);
            }}
          >
            {environments.map((row) => (
              <option key={row.id} value={row.id}>
                {environmentLabel(row)} · {row.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <form
        key={`${prefix}:${project.revision}:${environment.id}:${environment.revision}:${profile?.revision ?? 0}`}
        aria-label={profile ? "Enregistrer la configuration Hermès" : "Créer un profil Hermès"}
        onSubmit={async (event) => {
          event.preventDefault();
          setSaved(false);
          const data = new FormData(event.currentTarget);
          let toolPolicy: ReturnType<typeof toolPolicyFromForm>;
          try {
            toolPolicy = toolPolicyFromForm(data);
          } catch {
            setProblem("Vérifiez les outils sélectionnés et leurs plafonds.");
            return;
          }
          const limits = AgentLimits.safeParse({
            maxOutputTokens: Number(data.get("maxOutputTokens")),
            timeoutSeconds: Number(data.get("timeoutSeconds")),
            maxCostMicros: Math.round(Number(data.get("maxCost")) * 1_000_000),
            maxTurns: toolPolicy ? Number(data.get("tools-model-requests")) : 1,
            maxRequests: toolPolicy ? Number(data.get("tools-model-requests")) : 1,
          });
          if (!limits.success) {
            setProblem("Vérifiez les plafonds de sortie, de durée et de réservation.");
            return;
          }
          const configuration = {
            model: String(data.get("model")),
            limits: limits.data,
            toolPolicy,
            expectedProjectRevision: project.revision,
            expectedEnvironmentRevision: environment.revision,
          };
          const parsed = profile
            ? ConfigureAgentProfile.safeParse({
                ...configuration,
                expectedRevision: profile.revision,
              })
            : CreateAgentProfile.safeParse({
                ...configuration,
                projectId: project.id,
                environmentId: environment.id,
                role: String(data.get("role")),
              });
          if (!parsed.success) {
            setProblem("Vérifiez le rôle et le modèle sélectionnés.");
            return;
          }
          setProblem("");
          try {
            await post(
              profile ? `/agents/profiles/${profile.id}/configure` : "/agents/profiles",
              parsed.data,
            );
            setSaved(true);
          } catch {
            setProblem(
              "Le profil n’a pas été confirmé. Consultez le message de l’action puis actualisez.",
            );
          }
        }}
      >
        <fieldset className="agents-fields" disabled={disabled} onChange={() => setSaved(false)}>
          {!profile && (
            <label htmlFor={`${prefix}-role`}>
              Rôle du profil
              <select id={`${prefix}-role`} name="role" defaultValue={overview.roles[0]}>
                {overview.roles.map((role) => (
                  <option key={role} value={role}>
                    {agentRoleLabels[role]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label htmlFor={`${prefix}-model`}>
            Modèle OpenAI
            <select
              id={`${prefix}-model`}
              name="model"
              defaultValue={profile?.model ?? overview.models[0]}
            >
              {overview.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${prefix}-tokens`}>
            Plafond de sortie (tokens)
            <Input
              id={`${prefix}-tokens`}
              name="maxOutputTokens"
              type="number"
              min={32}
              max={2048}
              required
              defaultValue={defaults.maxOutputTokens}
            />
          </label>
          <label htmlFor={`${prefix}-timeout`}>
            Durée maximale (secondes)
            <Input
              id={`${prefix}-timeout`}
              name="timeoutSeconds"
              type="number"
              min={5}
              max={300}
              required
              defaultValue={defaults.timeoutSeconds}
            />
          </label>
          <label htmlFor={`${prefix}-cost`}>
            Réservation maximale par tâche (USD)
            <Input
              id={`${prefix}-cost`}
              name="maxCost"
              type="number"
              min={0.001}
              max={0.1}
              step={0.001}
              required
              defaultValue={defaults.maxCostMicros / 1_000_000}
            />
          </label>
          <p className="muted agents-wide">
            Sans outils sélectionnés pour une tâche : une seule requête modèle. La réservation
            protège le budget ; elle ne représente pas une facture OpenAI.
          </p>
          <AgentsToolsFields
            key={`${profile?.id ?? "new"}:${profile?.revision ?? 0}`}
            mode="profile"
            profile={profile}
            policy={profile?.toolPolicy}
            disabled={disabled}
          />
          <Button className="agents-submit" type="submit">
            {profile ? "Enregistrer la configuration" : "Créer le profil"}
          </Button>
        </fieldset>
      </form>
      {problem && (
        <p role="alert" className="agents-problem">
          {problem}
        </p>
      )}
      {saved && (
        <p role="status" className="success-message">
          Profil enregistré. Son runtime doit être disponible avant un lancement.
        </p>
      )}
    </section>
  );
}
