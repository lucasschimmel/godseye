import type { JobDefinitionView, JobRunView } from "@godseye/contracts";
import { useState } from "react";
import { timestamp } from "@/lib/api";
import { JobState, runStateLabels, triggerLabels } from "./jobs-labels";
import { EmptyState, SectionTitle } from "./shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const cancellable = ["queued", "running"];

function CancelForm({
  run,
  disabled,
  post,
}: {
  run: JobRunView;
  disabled: boolean;
  post: (path: string, body: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        Annuler
      </Button>
    );
  return (
    <form
      className="jobs-inline-form"
      aria-label="Annuler l’exécution"
      onSubmit={(event) => {
        event.preventDefault();
        const reason = String(new FormData(event.currentTarget).get("reason")).trim();
        if (reason.length < 3) return;
        post(`/jobs/runs/${run.id}/cancel`, { reason });
        setOpen(false);
      }}
    >
      <label htmlFor={`cancel-${run.id}`}>
        Motif de l’annulation
        <Input id={`cancel-${run.id}`} name="reason" required minLength={3} maxLength={240} />
      </label>
      <div className="jobs-actions">
        <Button disabled={disabled} type="submit">
          Confirmer l’annulation
        </Button>
        <Button variant="outline" type="button" onClick={() => setOpen(false)}>
          Garder l’exécution
        </Button>
      </div>
    </form>
  );
}

function ReconcileForm({
  run,
  disabled,
  post,
}: {
  run: JobRunView;
  disabled: boolean;
  post: (path: string, body: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        Réconcilier
      </Button>
    );
  return (
    <form
      className="jobs-inline-form"
      aria-label="Réconcilier l’exécution"
      onSubmit={(event) => {
        event.preventDefault();
        const evidenceRef = String(new FormData(event.currentTarget).get("evidenceRef")).trim();
        if (evidenceRef.length < 8) return;
        post(`/jobs/runs/${run.id}/reconcile`, {
          expectedState: run.state,
          resolution: "probe_read_only",
          evidenceRef,
        });
        setOpen(false);
      }}
    >
      <p className="jobs-warning">
        Une sonde en lecture seule vérifie l’effet. L’exécution n’est jamais relancée
        automatiquement ; sans preuve, elle reste inconnue.
      </p>
      <label htmlFor={`reconcile-${run.id}`}>
        Référence de la preuve
        <Input
          id={`reconcile-${run.id}`}
          name="evidenceRef"
          required
          minLength={8}
          maxLength={160}
        />
      </label>
      <div className="jobs-actions">
        <Button disabled={disabled} type="submit">
          Lancer la sonde
        </Button>
        <Button variant="outline" type="button" onClick={() => setOpen(false)}>
          Fermer
        </Button>
      </div>
    </form>
  );
}

export function JobsRuns({
  runs,
  definitions,
  disabled,
  post,
}: {
  runs: JobRunView[];
  definitions: JobDefinitionView[];
  disabled: boolean;
  post: (path: string, body: unknown) => void;
}) {
  const name = (id: string) => definitions.find((row) => row.id === id)?.name ?? "job supprimé";
  return (
    <section className="panel jobs-list" aria-label="Exécutions de jobs">
      <SectionTitle count={runs.length}>Exécutions</SectionTitle>
      {!runs.length ? (
        <EmptyState
          title="Aucune exécution"
          description="Aucun job n’a été déclenché. Les exécutions apparaîtront ici avec leur état exact, y compris les résultats incertains."
        />
      ) : (
        runs.map((run) => (
          <div className="operation-row" key={run.id}>
            <div>
              <strong className="mono">{name(run.definitionId)}</strong>
              <p>
                <JobState value={run.state} labels={runStateLabels} />
              </p>
              <small>
                {triggerLabels[run.trigger]} · tentative {run.attempt} · prévu{" "}
                {timestamp(run.scheduledFor)}
                {run.finishedAt ? ` · terminé ${timestamp(run.finishedAt)}` : ""}
              </small>
              {run.reason && <small>Motif : {run.reason}</small>}
              {(run.state === "unknown" || run.state === "reconciling") && (
                <small className="jobs-warning">
                  Résultat incertain : l’exécution n’est jamais relancée automatiquement.
                </small>
              )}
            </div>
            <div className="button-group">
              {cancellable.includes(run.state) && (
                <CancelForm run={run} disabled={disabled} post={post} />
              )}
              {(run.state === "unknown" || run.state === "reconciling") &&
                definitions.find((row) => row.id === run.definitionId)?.effectPolicy ===
                  "protected" && <ReconcileForm run={run} disabled={disabled} post={post} />}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
