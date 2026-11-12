import type { JobDefinitionView } from "@godseye/contracts";
import { Badge } from "./ui/badge";

export const runStateLabels: Record<string, string> = {
  queued: "File d’attente",
  running: "En cours",
  succeeded: "Réussi",
  failed: "Échoué",
  cancel_requested: "Annulation demandée",
  cancelled: "Annulé",
  unknown: "Inconnu",
  reconciling: "Réconciliation",
};
export const outboxStateLabels: Record<string, string> = {
  pending: "En attente",
  dispatching: "Envoi en cours",
  delivered: "Livré",
  failed: "Échoué",
  unknown: "Inconnu",
  reconciling: "Réconciliation",
  held: "Suspendu",
};
export const effectLabels: Record<string, string> = {
  read_only: "Lecture seule",
  idempotent: "Idempotent",
  protected: "Protégé",
};
export const triggerLabels: Record<string, string> = {
  cron: "Cron",
  event: "Événement",
  manual: "Manuel",
};

export function triggerDetail(trigger: JobDefinitionView["trigger"]) {
  if (trigger.kind === "cron") return `${triggerLabels.cron} · ${trigger.cron} (UTC)`;
  if (trigger.kind === "event") return `${triggerLabels.event} · ${trigger.eventType}`;
  return triggerLabels.manual;
}

/** State is always rendered as words; the color class only reinforces it. */
export function JobState({ value, labels }: { value: string; labels: Record<string, string> }) {
  return (
    <Badge variant="outline" className={`state job-state job-state-${value}`}>
      <span className="status-dot" />
      {labels[value] ?? value}
    </Badge>
  );
}
