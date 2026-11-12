import type {
  AdmitDatabaseInput,
  DatabaseOverviewView,
  OwnerSecurityView,
  ProjectDTO,
} from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Fingerprint } from "lucide-react";
import { DatabaseProfileForm } from "@/components/database-profile-form";
import { RecoveryPanel } from "@/components/recovery-panel";
import {
  EmptyState,
  Failure,
  Loading,
  PageHeading,
  SectionTitle,
  Status,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { api, resource, timestamp } from "@/lib/api";
import { ownerAuth } from "@/lib/owner";

export const Route = createFileRoute("/databases")({ component: Databases });
function Databases() {
  const overview = useQuery(resource<DatabaseOverviewView>("databases", "/databases"));
  const projects = useQuery(resource<ProjectDTO[]>("projects", "/projects"));
  const security = useQuery(resource<OwnerSecurityView>("owner-security", "/owner/security"));
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
  if (overview.isPending || projects.isPending) return <Loading />;
  if (overview.isError)
    return <Failure error={overview.error} retry={() => void overview.refetch()} />;
  if (projects.isError)
    return <Failure error={projects.error} retry={() => void projects.refetch()} />;
  const fresh = security.data?.fresh === true;
  const unavailable = overview.data.execution !== "qualified";
  function admit(
    preparationId: string,
    expectedHash: string,
    intent: AdmitDatabaseInput["intent"],
  ) {
    mutation.mutate({
      path: "/databases/admissions",
      body: { preparationId, expectedHash, intent },
    });
  }
  return (
    <>
      <PageHeading
        eyebrow="DONNÉES DES PROJETS"
        title="Bases de données"
        description="Une instance PostgreSQL indépendante pour chaque environnement. Les profils préparés restent distincts des ressources vérifiées."
        action={
          <Button
            variant="outline"
            disabled={confirmation.isPending}
            onClick={() => confirmation.mutate()}
          >
            <Fingerprint size={15} />
            Confirmer mon identité
          </Button>
        }
      />
      <section className="panel owner-assurance">
        <div>
          <h2>{unavailable ? "Exécution indisponible" : "Fournisseur indépendant qualifié"}</h2>
          <p>
            {unavailable
              ? "Aucun fournisseur PostgreSQL indépendant qualifié n’est connecté. Vous pouvez préparer un profil localement ; le provisionnement reste bloqué."
              : "Chaque admission exige les révisions courantes, la capacité disponible et une confirmation propriétaire récente."}
          </p>
          <p>
            Sauvegarde, restauration et rotation serveur : à qualifier. La préparation locale et le
            laboratoire natif ne qualifient pas l’isolation du serveur.
          </p>
          <p>
            {fresh
              ? "Identité propriétaire confirmée récemment."
              : "Confirmez votre identité pour préparer ou admettre un profil."}
          </p>
        </div>
      </section>
      {(mutation.isError || confirmation.isError) && (
        <Failure error={mutation.error ?? confirmation.error ?? new Error("L’action a échoué.")} />
      )}
      {mutation.isSuccess && (
        <p className="success-message" role="status">
          Demande enregistrée. L’état physique dépend des vérifications effectives.
        </p>
      )}
      <DatabaseProfileForm
        projects={projects.data}
        disabled={mutation.isPending || !fresh}
        prepare={(body) => mutation.mutate({ path: "/databases/preparations", body })}
      />
      <SectionTitle count={overview.data.preparations.length}>Profils préparés</SectionTitle>
      {overview.data.preparations.length === 0 ? (
        <EmptyState
          title="Aucun profil PostgreSQL"
          description="Préparez un profil pour un projet et un environnement précis."
        />
      ) : (
        <div className="environment-grid">
          {overview.data.preparations.map((preparation) => {
            const project = projects.data.find((item) => item.id === preparation.projectId);
            const environment = project?.environments.find(
              (item) => item.id === preparation.environmentId,
            );
            const allocation = overview.data.allocations.find(
              (item) => item.id === preparation.allocationId,
            );
            const latestPreparation = overview.data.preparations.findLast(
              (item) => item.allocationId === preparation.allocationId,
            );
            const currentAuthority =
              latestPreparation?.id === preparation.id &&
              project?.revision === preparation.expectedProjectRevision &&
              environment?.revision === preparation.expectedEnvironmentRevision;
            const actionDisabled = unavailable || !fresh || mutation.isPending || !currentAuthority;
            return (
              <section
                className="panel environment-card"
                key={preparation.id}
                aria-label={`Profil ${project?.name ?? "Projet"} ${environment?.name ?? "environnement"}`}
              >
                <h3>
                  {project?.name} · {environment?.name}
                </h3>
                <Status value={allocation?.state ?? "planned"} />
                <p className="mono">Profil : {preparation.hash.slice(0, 16)}</p>
                <p>Préparé le {timestamp(preparation.createdAt)}</p>
                <dl>
                  <div>
                    <dt>Données</dt>
                    <dd>{preparation.profile.dataGiB} GiB</dd>
                  </div>
                  <div>
                    <dt>WAL</dt>
                    <dd>{preparation.profile.walGiB} GiB</dd>
                  </div>
                  <div>
                    <dt>Connexions</dt>
                    <dd>{preparation.profile.maxConnections}</dd>
                  </div>
                </dl>
                <p>
                  Révisions liées : projet {preparation.expectedProjectRevision}, environnement{" "}
                  {preparation.expectedEnvironmentRevision}.
                </p>
                {allocation && (
                  <p>
                    État demandé :{" "}
                    {allocation.requestedState === "ready" ? "En service" : "Suspendu"}. Génération{" "}
                    {allocation.generation}.
                  </p>
                )}
                {!currentAuthority && (
                  <p className="muted">
                    Ce profil est remplacé ou ses révisions ont changé. Préparez un profil actualisé
                    avant toute nouvelle action.
                  </p>
                )}
                {allocation?.state === "released" && (
                  <p className="muted">
                    Allocation libérée avant tout effet physique. Préparez un nouveau profil pour
                    provisionner.
                  </p>
                )}
                {(allocation?.state === "unknown" || allocation?.state === "quarantined") && (
                  <p role="status">
                    Résultat incertain : capacité conservée, rapprochement requis dans les
                    opérations. Aucun nouveau démarrage automatique.
                  </p>
                )}
                {!allocation && (
                  <Button
                    disabled={actionDisabled}
                    onClick={() => admit(preparation.id, preparation.hash, "provision")}
                  >
                    Provisionner
                  </Button>
                )}
                {allocation?.state === "ready" && (
                  <Button
                    disabled={actionDisabled}
                    onClick={() => admit(preparation.id, preparation.hash, "suspend")}
                  >
                    Suspendre la base
                  </Button>
                )}
                {allocation?.state === "suspended" && (
                  <Button
                    disabled={actionDisabled}
                    onClick={() => admit(preparation.id, preparation.hash, "resume")}
                  >
                    Reprendre la base
                  </Button>
                )}
              </section>
            );
          })}
        </div>
      )}
      <RecoveryPanel projects={projects.data} databases={overview.data} fresh={fresh} />
    </>
  );
}
