import type { JobDefinitionView, JobRunView } from "@godseye/contracts";
import { timestamp } from "@/lib/api";
import { JobState, runStateLabels, triggerLabels } from "./jobs-labels";
import { EmptyState, SectionTitle } from "./shared";

/** Per-definition run history. Re-running a failed run is deliberately not offered: see the note below. */
export function JobsHistory({
  runs,
  definitions,
}: {
  runs: JobRunView[];
  definitions: JobDefinitionView[];
}) {
  return (
    <section className="panel jobs-list" aria-label="Historique des jobs">
      <SectionTitle count={definitions.length}>Historique par job</SectionTitle>
      {!definitions.length ? (
        <EmptyState
          title="Aucun historique"
          description="L’historique de chaque job apparaîtra ici après l’enregistrement d’une définition."
        />
      ) : (
        <>
          <p className="muted">
            Il n’existe pas d’action « Relancer » : une nouvelle exécution passe par « Déclencher »
            avec une nouvelle clé, jamais par la reprise d’une exécution échouée ou incertaine.
          </p>
          {definitions.map((definition) => {
            const history = runs.filter((run) => run.definitionId === definition.id);
            return (
              <details
                className="operation-row"
                key={definition.id}
                aria-label={`Historique de ${definition.name}`}
              >
                <summary>
                  <strong className="mono">{definition.name}</strong> · {history.length}{" "}
                  exécution(s) · conservation {definition.limits.retentionDays} j
                </summary>
                {!history.length ? (
                  <p className="muted">Aucune exécution pour ce job.</p>
                ) : (
                  <ul>
                    {history.map((run) => (
                      <li key={run.id}>
                        <JobState value={run.state} labels={runStateLabels} />{" "}
                        <small>
                          {triggerLabels[run.trigger]} · tentative {run.attempt} / maximum{" "}
                          {definition.limits.maxAttempts} · créé {timestamp(run.createdAt)}
                          {run.startedAt ? ` · démarré ${timestamp(run.startedAt)}` : ""}
                          {run.finishedAt ? ` · terminé ${timestamp(run.finishedAt)}` : ""}
                          {run.reason ? ` · motif ${run.reason}` : ""}
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
                <small className="muted">
                  Les exécutions terminées et les envois livrés ou échoués sont supprimés après{" "}
                  {definition.limits.retentionDays} jours ; les états inconnus ne le sont jamais.
                </small>
              </details>
            );
          })}
        </>
      )}
    </section>
  );
}
