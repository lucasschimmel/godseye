import type { JobsOverviewView, OwnerSecurityView, ProjectDTO } from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, RefreshCw } from "lucide-react";
import { api, resource } from "@/lib/api";
import { ownerAuth } from "@/lib/owner";
import { JobsDefinitions } from "./jobs-definitions";
import { JobsHistory } from "./jobs-history";
import { JobsOutbox } from "./jobs-outbox";
import { JobsRegisterForm } from "./jobs-register-form";
import { JobsRuns } from "./jobs-runs";
import { Failure, Loading, SectionTitle } from "./shared";
import { Button } from "./ui/button";

const engineTitles = {
  unconfigured: "Moteur non configuré, aucune exécution",
  local_fixture: "Moteur de fixture locale : exécutions simulées",
  unavailable: "Moteur indisponible, aucune exécution",
} as const;
const engineNotes = {
  unconfigured:
    "Les définitions peuvent être enregistrées, mais aucun job n’est planifié ni exécuté. Un moteur configuré mais arrêté ne sera jamais présenté comme sain.",
  local_fixture:
    "Les exécutions sont simulées sur cet ordinateur pour valider le parcours. Elles ne prouvent aucun effet réel.",
  unavailable:
    "Le moteur est configuré mais ne répond pas. Les exécutions en cours sont à considérer comme incertaines jusqu’à réconciliation.",
} as const;

export function JobsPanel() {
  const overview = useQuery({
    ...resource<JobsOverviewView>("jobs", "/jobs"),
    refetchInterval: 5000,
  });
  const projects = useQuery(resource<ProjectDTO[]>("projects", "/projects"));
  const security = useQuery({
    ...resource<OwnerSecurityView>("owner-security", "/owner/security"),
    refetchInterval: 5000,
  });
  const cache = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      api(path, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: () => cache.invalidateQueries(),
  });
  const confirmation = useMutation({
    mutationFn: async () => {
      const result = await ownerAuth.signIn.passkey();
      if (result.error) throw new Error("La confirmation a échoué.");
    },
    onSuccess: () => cache.invalidateQueries(),
  });
  if (!overview.data && overview.isPending) return <Loading />;
  if (!overview.data)
    return (
      <Failure
        error={overview.error ?? new Error("Les jobs sont indisponibles.")}
        retry={() => void overview.refetch()}
      />
    );
  if (projects.isPending) return <Loading />;
  if (projects.isError)
    return <Failure error={projects.error} retry={() => void projects.refetch()} />;
  const data = overview.data;
  const fresh = security.data?.fresh === true;
  const disabled = mutation.isPending || !fresh;
  const post = (path: string, body: unknown) => mutation.mutate({ path, body });
  const held = data.engine.heldEnvironmentIds.map((id) => {
    for (const project of projects.data) {
      const environment = project.environments.find((row) => row.id === id);
      if (environment) return `${project.name} · ${environment.name}`;
    }
    return "Environnement inconnu";
  });
  return (
    <>
      <section className="panel jobs-engine" data-engine={data.engine.state}>
        <div className="panel-heading">
          <SectionTitle>Moteur de jobs</SectionTitle>
          <div className="jobs-engine-actions">
            <Button
              variant="outline"
              disabled={overview.isFetching}
              onClick={() => void Promise.all([overview.refetch(), security.refetch()])}
            >
              <RefreshCw size={15} />
              Actualiser les jobs
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
        </div>
        <h2>{engineTitles[data.engine.state]}</h2>
        <p>{engineNotes[data.engine.state]}</p>
        {data.engine.reason && <p className="mono">Raison : {data.engine.reason}</p>}
        {held.length > 0 ? (
          <p role="status">Environnements suspendus, aucun job n’y démarre : {held.join(", ")}.</p>
        ) : (
          <p className="muted">Aucun environnement suspendu.</p>
        )}
        <p>
          {fresh
            ? "Identité propriétaire confirmée récemment."
            : "Confirmez votre identité pour enregistrer, suspendre, déclencher, annuler ou réconcilier."}
        </p>
      </section>
      {overview.isError && (
        <div className="error-message" role="alert">
          <span>
            Données possiblement périmées : la dernière actualisation a échoué. Les actions reposent
            sur des révisions connues et peuvent être refusées.
          </span>
        </div>
      )}
      {(mutation.isError || confirmation.isError) && (
        <Failure error={mutation.error ?? confirmation.error ?? new Error("L’action a échoué.")} />
      )}
      {mutation.isSuccess && (
        <p className="success-message" role="status">
          Demande enregistrée. Vérifiez l’état exact ci-dessous.
        </p>
      )}
      <JobsDefinitions overview={data} projects={projects.data} disabled={disabled} post={post} />
      <JobsRegisterForm
        projects={projects.data}
        heldEnvironmentIds={data.engine.heldEnvironmentIds}
        disabled={disabled}
        submit={(body) => post("/jobs/definitions", body)}
      />
      <JobsRuns runs={data.runs} definitions={data.definitions} disabled={disabled} post={post} />
      <JobsHistory runs={data.runs} definitions={data.definitions} />
      <JobsOutbox outbox={data.outbox} disabled={disabled} post={post} />
    </>
  );
}
