import type { DatabaseOverviewView, ProjectDTO, RecoveryOverviewView } from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, resource, timestamp } from "@/lib/api";
import { ordinaryEnvironment } from "@/lib/environment-labels";
import { RecoveryActivationForm } from "./recovery-activation-form";
import { EmptyState, Failure, Loading, SectionTitle, Status } from "./shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const policyFields = [
  { key: "fullRetention", label: "Générations complètes conservées", value: 4, min: 2, max: 4 },
  { key: "differentialRetention", label: "Différentielles conservées", value: 7, min: 1, max: 30 },
  { key: "repositoryGiB", label: "Dépôt réservé (GiB)", value: 8, min: 1, max: 16384 },
  { key: "stagingGiB", label: "Espace de préparation (GiB)", value: 2, min: 1, max: 4096 },
  { key: "archiveHeadroomGiB", label: "Marge WAL (GiB)", value: 1, min: 1, max: 1024 },
  {
    key: "maxArchiveAgeSeconds",
    label: "Fraîcheur archive maximale (secondes)",
    value: 300,
    min: 60,
    max: 86400,
  },
] as const;
export function RecoveryPanel({
  projects,
  databases,
  fresh,
}: {
  projects: ProjectDTO[];
  databases: DatabaseOverviewView;
  fresh: boolean;
}) {
  const overview = useQuery(resource<RecoveryOverviewView>("recovery", "/recovery"));
  const cache = useQueryClient();
  const [sourceId, setSourceId] = useState(""),
    [backupId, setBackupId] = useState("");
  const mutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      api(path, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: () => cache.invalidateQueries(),
  });
  if (overview.isPending) return <Loading />;
  if (overview.isError)
    return <Failure error={overview.error} retry={() => void overview.refetch()} />;
  const sources = databases.allocations.filter(
    (row) =>
      row.state === "ready" &&
      projects.some(
        (project) =>
          project.id === row.projectId &&
          project.environments.some(
            (environment) =>
              environment.id === row.environmentId && ordinaryEnvironment(environment),
          ),
      ),
  );
  const source = sources.find((row) => row.id === sourceId) ?? sources[0];
  const project = projects.find((row) => row.id === source?.projectId);
  const environment = project?.environments.find((row) => row.id === source?.environmentId);
  const backups = overview.data.backups.filter(
    (row) =>
      row.recoverableFrom &&
      row.recoverableTo &&
      ["archive-healthy", "restore-verified"].includes(row.status),
  );
  const backup = backups.find((row) => row.id === backupId) ?? backups[0];
  const restoreProject = projects.find((row) => row.id === backup?.projectId);
  const restoreEnvironment = restoreProject?.environments.find(
    (row) => row.id === backup?.environmentId,
  );
  const disabled = mutation.isPending || !fresh;
  return (
    <>
      <SectionTitle count={overview.data.backups.length}>
        Sauvegardes et restauration isolée
      </SectionTitle>
      <section className="panel owner-assurance">
        <div>
          <h2>
            {overview.data.execution === "qualified"
              ? "Autorité de sauvegarde vérifiée"
              : "Exécution de sauvegarde à qualifier"}
          </h2>
          <p>
            Les préparations décrivent une sauvegarde physique complète ou différentielle et son
            dépôt chiffré. L’exécution exige un fournisseur privé qualifié et une capacité réservée.
          </p>
          <p>
            Restauration dans un nouvel environnement en maintien de récupération : base en lecture
            seule, applications, tâches, agents et accès de service bloqués. La source est
            conservée.
          </p>
          {overview.data.activation === "blocked" ? (
            <p>
              Activation bloquée : fichiers, authentification, configuration, historique des effets
              et arrêt des producteurs restent à qualifier.
            </p>
          ) : (
            <p>
              Activation possible uniquement après confirmation du propriétaire : la source est
              isolée, la base restaurée promue puis désignée active. Fichiers, authentification et
              configuration ne sont pas restaurés.
            </p>
          )}
          <p>
            Politique préparée : complète hebdomadaire, différentielle quotidienne, archivage
            continu. Aucun ordonnanceur automatique qualifié n’exécute cette politique.
          </p>
        </div>
      </section>
      {mutation.isError && <Failure error={mutation.error} />}
      {mutation.isSuccess && (
        <p role="status" className="success-message">
          Demande de récupération enregistrée. Consultez l’état vérifié ci-dessous.
        </p>
      )}
      <form
        key={`backup-${source?.id}-${project?.revision}-${environment?.revision}`}
        className="panel project-form"
        aria-label="Préparer une sauvegarde physique"
        onSubmit={(event) => {
          event.preventDefault();
          if (!source || !project || !environment) return;
          const form = new FormData(event.currentTarget);
          mutation.mutate({
            path: "/recovery/backups/preparations",
            body: {
              projectId: project.id,
              environmentId: environment.id,
              sourceAllocationId: source.id,
              expectedProjectRevision: project.revision,
              expectedEnvironmentRevision: environment.revision,
              kind: form.get("kind"),
              policy: Object.fromEntries(
                policyFields.map(({ key }) => [key, Number(form.get(key))]),
              ),
            },
          });
        }}
      >
        <h3>Préparer une sauvegarde physique</h3>
        <label>
          Base source vérifiée
          <select
            required
            value={source?.id ?? ""}
            onChange={(event) => setSourceId(event.target.value)}
          >
            <option value="" disabled>
              Choisir une base source
            </option>
            {sources.map((row) => (
              <option key={row.id} value={row.id}>
                {projects.find((p) => p.id === row.projectId)?.name} ·{" "}
                {
                  projects
                    .find((p) => p.id === row.projectId)
                    ?.environments.find((e) => e.id === row.environmentId)?.name
                }
              </option>
            ))}
          </select>
        </label>
        <label>
          Type de sauvegarde
          <select name="kind" defaultValue="full">
            <option value="full">Complète</option>
            <option value="diff">Différentielle</option>
          </select>
        </label>
        <div className="infra-fields">
          {policyFields.map((field) => (
            <label key={field.key} htmlFor={`recovery-${field.key}`}>
              {field.label}
              <Input
                id={`recovery-${field.key}`}
                name={field.key}
                type="number"
                required
                min={field.min}
                max={field.max}
                defaultValue={field.value}
              />
            </label>
          ))}
        </div>
        {!source && (
          <p>
            Aucune base source vérifiée. Provisionnez et vérifiez une base indépendante avant de
            préparer sa sauvegarde.
          </p>
        )}
        <Button type="submit" disabled={disabled || !source}>
          Préparer la sauvegarde
        </Button>
      </form>
      <form
        key={`restore-${backup?.id}-${restoreProject?.revision}-${restoreEnvironment?.revision}`}
        className="panel project-form"
        aria-label="Préparer une restauration isolée"
        onSubmit={(event) => {
          event.preventDefault();
          if (!backup || !restoreProject || !restoreEnvironment) return;
          const form = new FormData(event.currentTarget);
          mutation.mutate({
            path: "/recovery/restores/preparations",
            body: {
              projectId: restoreProject.id,
              sourceEnvironmentId: restoreEnvironment.id,
              backupId: backup.id,
              expectedProjectRevision: restoreProject.revision,
              expectedEnvironmentRevision: restoreEnvironment.revision,
              targetTime: new Date(String(form.get("targetTime"))).toISOString(),
              name: form.get("name"),
            },
          });
        }}
      >
        <h3>Préparer un nouvel environnement restauré</h3>
        <label>
          Sauvegarde et archive vérifiées
          <select
            required
            value={backup?.id ?? ""}
            onChange={(event) => setBackupId(event.target.value)}
          >
            <option value="" disabled>
              Choisir une sauvegarde
            </option>
            {backups.map((row) => (
              <option key={row.id} value={row.id}>
                {projects.find((p) => p.id === row.projectId)?.name} · {timestamp(row.createdAt)}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="recovery-environment-name">
          Nom du nouvel environnement
          <Input
            id="recovery-environment-name"
            name="name"
            required
            pattern="[a-z][a-z0-9-]+"
            minLength={2}
            maxLength={40}
            placeholder="restauration-controle"
          />
        </label>
        <label htmlFor="recovery-target-time">
          Point de restauration (heure locale)
          <Input
            id="recovery-target-time"
            name="targetTime"
            type="datetime-local"
            step="1"
            required
          />
        </label>
        {backup?.recoverableFrom && backup.recoverableTo && (
          <p>
            Intervalle vérifié : {timestamp(backup.recoverableFrom)} à{" "}
            {timestamp(backup.recoverableTo)}. La source reste conservée ; aucun trafic applicatif
            n’est activé.
          </p>
        )}
        {!backup && <p>Aucune sauvegarde avec intervalle d’archive récent et vérifié.</p>}
        <Button type="submit" disabled={disabled || !backup}>
          Préparer la restauration isolée
        </Button>
      </form>
      {overview.data.preparations.length === 0 ? (
        <EmptyState
          title="Aucune préparation de récupération"
          description="Les préparations et les résultats physiques vérifiés sont conservés séparément."
        />
      ) : (
        <div className="environment-grid">
          {overview.data.preparations.map((preparation) => {
            const run = overview.data.runs.find((row) => row.preparationId === preparation.id);
            const currentProject = projects.find((p) => p.id === preparation.projectId);
            const currentEnvironment = currentProject?.environments.find(
              (e) => e.id === preparation.sourceEnvironmentId,
            );
            const restoredEnvironment = currentProject?.environments.find(
              (e) => e.id === preparation.environmentId,
            );
            const current =
              currentProject?.revision === preparation.expectedProjectRevision &&
              currentEnvironment?.revision === preparation.expectedEnvironmentRevision;
            return (
              <section className="panel environment-card" key={preparation.id}>
                <h3>
                  {preparation.kind === "restore"
                    ? `Restauration · ${preparation.name}`
                    : preparation.kind === "check"
                      ? "Vérification de l’archive"
                      : preparation.kind === "full"
                        ? "Sauvegarde complète"
                        : "Sauvegarde différentielle"}
                </h3>
                <Status value={run?.state ?? "planned"} />
                <p className="mono">Préparation {preparation.hash.slice(0, 16)}</p>
                <p>{timestamp(preparation.createdAt)}</p>
                <p>
                  Dépôt {preparation.policy.repositoryGiB} GiB · préparation{" "}
                  {preparation.policy.stagingGiB} GiB · marge WAL{" "}
                  {preparation.policy.archiveHeadroomGiB} GiB
                </p>
                {preparation.kind === "restore" && (
                  <p>
                    Maintien de récupération permanent. Identité et catalogue PostgreSQL issus de la
                    source ; volumes et réseau distincts.
                    {overview.data.activation === "blocked"
                      ? " Activation indisponible."
                      : " Activation soumise à la confirmation du propriétaire."}
                  </p>
                )}
                {preparation.kind === "restore" &&
                  run?.state === "restore-verified" &&
                  currentProject &&
                  restoredEnvironment?.recoveryHold &&
                  restoredEnvironment.kind === "recovery" &&
                  overview.data.activation !== "blocked" && (
                    <RecoveryActivationForm
                      project={currentProject}
                      environment={restoredEnvironment}
                      fresh={fresh}
                    />
                  )}
                {run?.state === "unknown" && (
                  <p>
                    Résultat incertain : toutes les réservations sont conservées. Rapprochement
                    requis dans les opérations, sans répétition automatique.
                  </p>
                )}
                {!current && (
                  <p className="muted">
                    Les révisions ont changé. Une nouvelle préparation est nécessaire.
                  </p>
                )}
                {!run && (
                  <Button
                    disabled={disabled || !current || overview.data.execution !== "qualified"}
                    onClick={() =>
                      mutation.mutate({
                        path: "/recovery/admissions",
                        body: { preparationId: preparation.id, expectedHash: preparation.hash },
                      })
                    }
                  >
                    Confirmer cette préparation
                  </Button>
                )}
              </section>
            );
          })}
        </div>
      )}
      {overview.data.backups.map((row) => (
        <section className="panel environment-card" key={row.id}>
          <h3>Résultat de sauvegarde</h3>
          <Status value={row.status} />
          <p>Créée le {timestamp(row.createdAt)}</p>
          <p>Archive vérifiée le {timestamp(row.archiveCheckedAt)}.</p>
          <p>
            Base : {timestamp(row.coverage.databaseAt)}. Fichiers, authentification, configuration :
            absents. Historique des effets et producteurs : non qualifiés.
          </p>
          {row.recoverableFrom && row.recoverableTo && (
            <p>
              Archive prouvée du {timestamp(row.recoverableFrom)} au {timestamp(row.recoverableTo)}.
            </p>
          )}
          <Button
            disabled={disabled}
            onClick={() => {
              const ownerProject = projects.find((p) => p.id === row.projectId);
              const ownerEnvironment = ownerProject?.environments.find(
                (e) => e.id === row.environmentId,
              );
              if (!ownerProject || !ownerEnvironment) return;
              mutation.mutate({
                path: "/recovery/archives/preparations",
                body: {
                  projectId: row.projectId,
                  sourceEnvironmentId: row.environmentId,
                  backupId: row.id,
                  expectedProjectRevision: ownerProject.revision,
                  expectedEnvironmentRevision: ownerEnvironment.revision,
                },
              });
            }}
          >
            Préparer une vérification d’archive
          </Button>
          {row.verifiedAt && (
            <p>
              Restauration vérifiée le {timestamp(row.verifiedAt)} ; environnement maintenu isolé.
            </p>
          )}
        </section>
      ))}
    </>
  );
}
