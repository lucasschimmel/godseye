import type { AgentOverviewView, ProjectDTO } from "@godseye/contracts";
import { useState } from "react";
import { runtimeHeading } from "@/lib/deployment";
import { useDeployment } from "@/lib/use-deployment";
import { AgentsAction } from "./agents-action";
import { type AgentPost, agentMoney, agentProfileScope, agentRoleLabels } from "./agents-labels";
import { AgentsProfileForm } from "./agents-profile-form";
import { EmptyState, SectionTitle } from "./shared";
import { Button } from "./ui/button";

export function AgentsProfiles({
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
  const [editing, setEditing] = useState<string | null>(null);
  const deployment = useDeployment();
  return (
    <section className="panel agents-profiles" aria-label="Profils Hermès">
      <SectionTitle count={overview.profiles.length}>Profils Hermès</SectionTitle>
      {!overview.profiles.length && (
        <EmptyState
          title="Aucun profil lié"
          description="Associez un rôle à un environnement pour préparer vos premières tâches Hermès."
        />
      )}
      <div className="agents-profile-grid">
        {overview.profiles.map((profile) => {
          const { project, environment, label } = agentProfileScope(profile, projects);
          const busy = profile.busy;
          const stale =
            project?.revision !== profile.projectRevision ||
            environment?.revision !== profile.environmentRevision;
          return (
            <article
              className="agents-profile"
              key={profile.id}
              aria-label={`${agentRoleLabels[profile.role]} · ${label}`}
            >
              <div className="agents-profile-top">
                <h3>{agentRoleLabels[profile.role]}</h3>
                <span
                  className={`agents-badge ${profile.paused || stale ? "agents-attention" : ""}`}
                >
                  {profile.paused ? "En pause" : stale ? "À reconfirmer" : "Lié"}
                </span>
              </div>
              <p>{label}</p>
              <dl className="agents-meta">
                <div>
                  <dt>Modèle</dt>
                  <dd>{profile.model}</dd>
                </div>
                <div>
                  <dt>Skill</dt>
                  <dd>
                    {profile.skill.id} · {profile.skill.version}
                  </dd>
                </div>
                <div>
                  <dt>Limites</dt>
                  <dd>
                    {profile.limits.maxOutputTokens} tokens · {profile.limits.timeoutSeconds} s
                  </dd>
                </div>
                <div>
                  <dt>Réservation</dt>
                  <dd>{agentMoney(profile.limits.maxCostMicros)} / tâche</dd>
                </div>
              </dl>
              <p className="muted">
                {profile.toolPolicy
                  ? `${profile.toolPolicy.tools.length} outils autorisables · ${profile.limits.maxRequests} requêtes modèle maximum`
                  : "Aucun outil · une requête modèle"}
              </p>
              <p className="muted">
                {runtimeHeading(profile.runtime === "available", deployment.isLocal)} · Révision{" "}
                {profile.revision}
              </p>
              <details className="agents-binding-ids">
                <summary>Identifiants du périmètre</summary>
                <dl className="agents-meta">
                  <div>
                    <dt>Projet</dt>
                    <dd>{profile.projectId}</dd>
                  </div>
                  <div>
                    <dt>Environnement</dt>
                    <dd>{profile.environmentId}</dd>
                  </div>
                  <div>
                    <dt>Profil</dt>
                    <dd>{profile.id}</dd>
                  </div>
                </dl>
              </details>
              {busy && (
                <p className="agents-notice" role="status">
                  Une tâche en cours ou incertaine conserve ce profil. Réconciliez-la avant de le
                  reconfigurer.
                </p>
              )}
              <div className="agents-actions">
                {profile.activeTaskId && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (profile.activeTaskId) selectTask(profile.activeTaskId);
                    }}
                  >
                    Voir la tâche active
                  </Button>
                )}
                <AgentsAction
                  label={profile.paused ? "Reprendre le profil" : "Mettre en pause"}
                  path={`/agents/profiles/${profile.id}/${profile.paused ? "resume" : "pause"}`}
                  body={{ expectedRevision: profile.revision }}
                  disabled={disabled}
                  post={post}
                />
                <Button
                  variant="outline"
                  disabled={disabled || busy}
                  onClick={() => setEditing(editing === profile.id ? null : profile.id)}
                >
                  {editing === profile.id ? "Fermer la configuration" : "Configurer le profil"}
                </Button>
              </div>
              {editing === profile.id && (
                <AgentsProfileForm
                  key={profile.id}
                  overview={overview}
                  projects={projects}
                  disabled={disabled || busy}
                  post={post}
                  profile={profile}
                />
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
