import type { AgentOverviewView, OwnerSecurityView, ProjectDTO } from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Fingerprint, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { api, resource } from "@/lib/api";
import { ownerAuth } from "@/lib/owner";
import { AgentsChat } from "./agents-chat";
import { AgentsCoding } from "./agents-coding";
import { AGENT_REFRESH_MS, type AgentPost } from "./agents-labels";
import { AgentsPlans } from "./agents-plans";
import { AgentsProfileForm } from "./agents-profile-form";
import { AgentsProfiles } from "./agents-profiles";
import { AgentsTaskForm } from "./agents-task-form";
import { AgentsTaskHistory } from "./agents-task-history";
import { Failure, Loading } from "./shared";
import { Button } from "./ui/button";

export function AgentsPanel() {
  const overview = useQuery({
    ...resource<AgentOverviewView>("agents", "/agents"),
    refetchInterval: AGENT_REFRESH_MS,
  });
  const projects = useQuery({
    ...resource<ProjectDTO[]>("projects", "/projects"),
    refetchInterval: AGENT_REFRESH_MS,
  });
  const security = useQuery({
    ...resource<OwnerSecurityView>("owner-security", "/owner/security"),
    refetchInterval: AGENT_REFRESH_MS,
  });
  const cache = useQueryClient();
  const intents = useRef(new Map<string, string>());
  const [selectedTask, setSelectedTask] = useState("");
  const mutation = useMutation({
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
  const confirmation = useMutation({
    mutationFn: async () => {
      const result = await ownerAuth.signIn.passkey();
      if (result.error) throw new Error("La confirmation propriétaire a échoué.");
    },
    onSuccess: async () => {
      await cache.invalidateQueries();
    },
  });
  if (!overview.data)
    return overview.isError ? (
      <Failure error={overview.error} retry={() => void overview.refetch()} />
    ) : (
      <Loading />
    );
  if (!projects.data)
    return projects.isError ? (
      <Failure error={projects.error} retry={() => void projects.refetch()} />
    ) : (
      <Loading />
    );
  const data = overview.data;
  const stale = overview.isError || projects.isError;
  const disabled = mutation.isPending || stale;
  const freshIdentity = !security.isError && security.data?.fresh === true;
  const sensitiveDisabled = disabled || !freshIdentity;
  const post: AgentPost = (path, body, method = "POST") =>
    mutation.mutateAsync({ path, body, method });
  return (
    <div className="agents-center">
      <section className="panel agents-runtime" aria-label="Runtime Hermès">
        <div className="agents-runtime-heading">
          <Bot size={28} />
          <div>
            <p className="eyebrow">HERMÈS · LOCAL</p>
            <h2>
              {data.status === "available"
                ? "Runtime local configuré"
                : "Runtime local à connecter"}
            </h2>
          </div>
          <span className={`agents-badge ${data.status === "available" ? "" : "agents-attention"}`}>
            {data.status === "available" ? "Configuré" : "Non configuré"}
          </span>
        </div>
        <p>
          {data.status === "available"
            ? "Chaque lancement vérifie à nouveau son périmètre, ses droits et sa réservation."
            : "Vous pouvez lier et configurer vos profils. Le lancement restera bloqué jusqu’à la connexion d’un runtime autorisé pour leur périmètre."}
        </p>
        <p className="muted">
          Un skill de contexte versionné et des outils de fichiers autorisés tâche par tâche. GPT-6
          Luna par défaut. Conversations en direct et tâches suivies en arrière-plan ; fermer cet
          onglet n’annule pas la tâche.
        </p>
        <p className="muted">
          {data.tools.length
            ? "Outils isolés configurés ; leur disponibilité et leurs limites sont vérifiées avant chaque tâche."
            : "Outils isolés indisponibles. Les tâches sans outils restent accessibles si le modèle est configuré."}{" "}
          Les outils Hermès ne donnent pas accès aux commandes système ni aux builds. Pour coder
          dans un invité KVM jetable, consultez la disponibilité de Codex et Claude Code ci-dessous.
        </p>
        <div className="agents-actions">
          <Button
            variant="outline"
            disabled={overview.isFetching}
            onClick={() =>
              void Promise.all([overview.refetch(), projects.refetch(), security.refetch()])
            }
          >
            <RefreshCw size={15} />
            Actualiser Hermès
          </Button>
          <Button
            variant="outline"
            disabled={confirmation.isPending}
            onClick={() => confirmation.mutate()}
          >
            <Fingerprint size={15} />
            Confirmer mon identité
          </Button>
        </div>
        <p className="muted">
          {security.isError
            ? "La confirmation propriétaire n’a pas pu être actualisée. Les demandes d’arrêt restent disponibles."
            : freshIdentity
              ? "Identité propriétaire confirmée récemment."
              : "Confirmez votre identité pour créer un profil, le reconfigurer ou lancer une tâche. Les demandes d’arrêt restent disponibles."}
        </p>
      </section>
      {stale && (
        <p className="agents-notice" role="alert">
          Actualisation échouée : les données peuvent être périmées. Actualisez avant une nouvelle
          action.
        </p>
      )}
      {(mutation.isError || confirmation.isError) && (
        <Failure
          error={
            mutation.error ?? confirmation.error ?? new Error("L’action Hermès n’a pas abouti.")
          }
        />
      )}
      <AgentsCoding
        projects={projects.data}
        post={post}
        disabled={disabled}
        fresh={freshIdentity}
      />
      <AgentsPlans
        projects={projects.data}
        overview={data}
        post={post}
        disabled={disabled}
        fresh={freshIdentity}
        selectTask={(id) => {
          setSelectedTask(id);
          document.getElementById("agents-task-history")?.scrollIntoView({ block: "start" });
        }}
      />
      <AgentsChat
        profiles={data.profiles}
        projects={projects.data}
        post={post}
        disabled={disabled}
        fresh={freshIdentity}
        toolsAvailable={data.tools.length > 0}
      />
      <AgentsProfiles
        overview={data}
        projects={projects.data}
        disabled={sensitiveDisabled}
        post={post}
        selectTask={setSelectedTask}
      />
      <div className="agents-composer">
        <AgentsProfileForm
          overview={data}
          projects={projects.data}
          disabled={sensitiveDisabled}
          post={post}
        />
        <AgentsTaskForm
          overview={data}
          projects={projects.data}
          disabled={sensitiveDisabled}
          post={post}
          selectTask={setSelectedTask}
        />
      </div>
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
  );
}
