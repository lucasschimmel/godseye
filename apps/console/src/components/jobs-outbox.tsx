import {
  type OutboxIntentView,
  ReconcileOutbox,
  type ReconcileOutboxInput,
} from "@godseye/contracts";
import { useState } from "react";
import { timestamp } from "@/lib/api";
import { JobState, outboxStateLabels } from "./jobs-labels";
import { EmptyState, SectionTitle } from "./shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const resolutions = [
  { value: "observed_delivered", label: "Effet observé : livré" },
  {
    value: "observed_absent_retry",
    label: "Effet observé absent : autoriser une nouvelle tentative",
  },
  { value: "abandon", label: "Abandonner cet effet" },
] as const;
const reconcilable = ["unknown", "reconciling", "held"] as const;

function ReconcileForm({
  intent,
  disabled,
  post,
}: {
  intent: OutboxIntentView;
  disabled: boolean;
  post: (path: string, body: unknown) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      className="jobs-inline-form"
      aria-label={`Réconcilier l’effet ${intent.effectKey}`}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const parsed = ReconcileOutbox.safeParse({
          expectedState: intent.state,
          resolution: String(data.get("resolution")),
          evidenceRef: String(data.get("evidenceRef")).trim(),
        } satisfies Partial<Record<keyof ReconcileOutboxInput, string>>);
        if (!parsed.success) {
          setProblem("La référence de preuve doit contenir entre 8 et 160 caractères.");
          return;
        }
        setProblem(null);
        post(`/jobs/outbox/${intent.id}/reconcile`, parsed.data);
      }}
    >
      <p className="jobs-warning" role="note">
        Un effet inconnu n’est jamais relancé automatiquement : une nouvelle tentative n’a lieu que
        si vous attestez, preuve à l’appui, que l’effet est absent.
      </p>
      <label htmlFor={`resolution-${intent.id}`}>
        Résolution
        <select id={`resolution-${intent.id}`} name="resolution" defaultValue="observed_delivered">
          {resolutions.map((row) => (
            <option key={row.value} value={row.value}>
              {row.label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`evidence-${intent.id}`}>
        Référence de preuve (ticket, journal, identifiant externe)
        <Input
          id={`evidence-${intent.id}`}
          name="evidenceRef"
          required
          minLength={8}
          maxLength={160}
        />
      </label>
      {problem && <p role="alert">{problem}</p>}
      <Button disabled={disabled} type="submit">
        Réconcilier sans relancer
      </Button>
    </form>
  );
}

export function JobsOutbox({
  outbox,
  disabled,
  post,
}: {
  outbox: OutboxIntentView[];
  disabled: boolean;
  post: (path: string, body: unknown) => void;
}) {
  return (
    <section className="panel jobs-list" aria-label="Effets sortants">
      <SectionTitle count={outbox.length}>Effets sortants (outbox)</SectionTitle>
      {!outbox.length ? (
        <EmptyState
          title="Aucun effet sortant"
          description="Les effets externes des jobs passent par cette file : chacun a une clé d’effet unique et un état exact. Rien n’y est présenté comme livré sans preuve."
        />
      ) : (
        outbox.map((intent) => (
          <div className="operation-row" key={intent.id}>
            <div>
              <strong className="mono">{intent.destination}</strong>
              <p>
                <JobState value={intent.state} labels={outboxStateLabels} />
              </p>
              <small className="mono">{intent.effectKey}</small>
              <small>
                {intent.attempts} tentative(s) · créé {timestamp(intent.createdAt)}
                {intent.settledAt ? ` · réglé ${timestamp(intent.settledAt)}` : ""}
              </small>
              {intent.lastError && <small>Dernière erreur : {intent.lastError}</small>}
              {intent.state === "failed" && (
                <small>Échec confirmé : ce n’est pas un résultat inconnu.</small>
              )}
            </div>
            {(reconcilable as readonly string[]).includes(intent.state) && (
              <ReconcileForm intent={intent} disabled={disabled} post={post} />
            )}
          </div>
        ))
      )}
    </section>
  );
}
