import type { ProjectDTO } from "@godseye/contracts";
import { Badge } from "./ui/badge";

export const protectionLabels: Record<string, string> = {
  unconfigured: "À connecter",
  unavailable: "Indisponible",
  none: "Aucune donnée",
  unknown: "Inconnu, non vérifié",
  healthy: "Sain",
  degraded: "Dégradé",
  lagging: "Archive en retard",
  "headroom-low": "Marge d’archive insuffisante",
  qualified: "Qualifié",
  "never-rotated": "Jamais pivoté",
  "in-progress": "Rotation en cours",
  succeeded: "Pivoté",
  failed: "Échec",
  open: "Ouvert",
  acknowledged: "Acquitté",
  resolved: "Résolu",
};
export const reasonLabels: Record<string, string> = {
  ARCHIVE_STALE: "L’archive est plus ancienne que la limite de la politique.",
  ARCHIVE_DISCONTINUOUS: "L’archive n’est pas continue.",
  HEADROOM_LOW: "La marge WAL et archive est sous le seuil de la politique.",
  PROVIDER_UNAVAILABLE:
    "Le fournisseur de sauvegarde est indisponible : l’état ne peut pas être vérifié.",
  PROVIDER_UNCONFIGURED: "Aucun fournisseur de sauvegarde n’est connecté.",
  EVIDENCE_INVALID: "Les preuves conservées sont invalides.",
  ARCHIVE_STATUS_UNKNOWN:
    "L’état de l’archive ne peut pas être vérifié ; la récupération est inconnue.",
  ROTATION_FAILED: "La dernière rotation a échoué sans modifier le rôle.",
  ROTATION_OUTCOME_UNKNOWN: "Le résultat de la rotation est incertain ; réconciliation requise.",
};
export const roleLabels: Record<string, string> = {
  migration: "Migration",
  api: "API",
  worker: "Worker",
  auth: "Authentification",
  reader: "Lecture seule",
  backup: "Sauvegarde",
  workflow: "Workflow",
  workflowMigration: "Migration workflow",
};
export function ProtectionBadge({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={`state state-${value}`}>
      <span className="status-dot" />
      {protectionLabels[value] ?? value}
    </Badge>
  );
}
export function scopeName(
  projects: ProjectDTO[],
  projectId: string,
  environmentId: string,
): string {
  const project = projects.find((item) => item.id === projectId);
  const environment = project?.environments.find((item) => item.id === environmentId);
  return `${project?.name ?? "Projet"} · ${environment?.name ?? "environnement"}`;
}
