import type { JobDefinitionView, JobsOverviewView, ProjectDTO } from "@godseye/contracts";
import { timestamp } from "@/lib/api";
import { effectLabels, JobState, triggerDetail } from "./jobs-labels";
import { EmptyState, SectionTitle } from "./shared";
import { Button } from "./ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const pausedLabels = { true: "En pause", false: "Actif" } as const;

function scope(definition: JobDefinitionView, projects: ProjectDTO[]) {
  const project = projects.find((row) => row.id === definition.projectId);
  const environment = project?.environments.find((row) => row.id === definition.environmentId);
  return `${project?.name ?? "Projet"} · ${environment?.name ?? "Environnement"}`;
}

export function JobsDefinitions({
  overview,
  projects,
  disabled,
  post,
}: {
  overview: JobsOverviewView;
  projects: ProjectDTO[];
  disabled: boolean;
  post: (path: string, body: unknown) => void;
}) {
  const engineActive = overview.engine.state === "local_fixture";
  return (
    <section className="panel jobs-list" aria-label="Définitions de jobs">
      <SectionTitle count={overview.definitions.length}>Définitions</SectionTitle>
      {!overview.definitions.length ? (
        <EmptyState
          title="Aucune définition de job"
          description="Enregistrez un job ci-dessous : nom, gestionnaire, déclencheur et limites. Une définition enregistrée ne s’exécute pas tant que le moteur n’est pas actif."
        />
      ) : (
        <>
          {!engineActive && (
            <p className="muted">
              Le moteur n’est pas actif : « Déclencher » ne fait que mettre l’exécution en file
              d’attente, rien ne s’exécute.
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Déclencheur</TableHead>
                <TableHead>Effet</TableHead>
                <TableHead>Limites</TableHead>
                <TableHead>État</TableHead>
                <TableHead>Prochain départ</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.definitions.map((definition) => (
                <TableRow key={definition.id}>
                  <TableCell>
                    <strong className="mono">{definition.name}</strong>
                    <small className="block muted">
                      {definition.handler} · {scope(definition, projects)}
                    </small>
                  </TableCell>
                  <TableCell>{triggerDetail(definition.trigger)}</TableCell>
                  <TableCell>{effectLabels[definition.effectPolicy]}</TableCell>
                  <TableCell>
                    <small className="block">
                      {definition.limits.maxConcurrent} simultané(s) ·{" "}
                      {definition.limits.maxAttempts} tentative(s)
                    </small>
                    <small className="block muted">
                      {definition.limits.timeoutSeconds} s · {definition.limits.retentionDays} j
                    </small>
                  </TableCell>
                  <TableCell>
                    <JobState
                      value={String(definition.paused)}
                      labels={pausedLabels as Record<string, string>}
                    />
                  </TableCell>
                  <TableCell>
                    {definition.paused
                      ? "Suspendu"
                      : definition.nextFireAt
                        ? timestamp(definition.nextFireAt)
                        : "Aucun départ planifié"}
                  </TableCell>
                  <TableCell>
                    <div className="jobs-actions">
                      <Button
                        variant="outline"
                        disabled={disabled}
                        onClick={() =>
                          post(
                            `/jobs/definitions/${definition.id}/${definition.paused ? "resume" : "pause"}`,
                            { expectedRevision: definition.revision },
                          )
                        }
                      >
                        {definition.paused ? "Reprendre" : "Mettre en pause"}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={disabled || definition.paused}
                        onClick={() =>
                          post(`/jobs/definitions/${definition.id}/trigger`, {
                            expectedRevision: definition.revision,
                            dedupeKey: `manual-${crypto.randomUUID()}`,
                          })
                        }
                      >
                        Déclencher
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </section>
  );
}
