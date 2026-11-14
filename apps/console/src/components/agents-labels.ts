import type { AgentProfileView, ProjectDTO } from "@godseye/contracts";
import { ordinaryEnvironment } from "@/lib/environment-labels";

export const AGENT_REFRESH_MS = 3000;
export const agentRoleLabels = {
  operations: "Opérations",
  security: "Sécurité",
  "research-marketing": "Recherche & marketing",
} as const;
export const agentStateLabels = {
  queued: "En file",
  running: "En cours",
  cancel_requested: "Arrêt demandé",
  succeeded: "Terminée",
  failed: "Échec",
  cancelled: "Annulée",
  unknown: "Résultat incertain",
  reconciling: "Vérification en cours",
} as const;
export type AgentPost = (path: string, body: unknown, method?: "POST" | "PUT") => Promise<unknown>;
export const agentMoney = (micros: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 3,
  }).format(micros / 1_000_000);

export function agentEnvironments(project: ProjectDTO) {
  if (project.status === "suspended") return [];
  return project.environments.filter(
    (environment) =>
      ordinaryEnvironment(environment) &&
      !["suspended", "unknown", "quarantined", "expired"].includes(environment.status) &&
      (!environment.expiresAt || Date.parse(environment.expiresAt) > Date.now()),
  );
}

export function agentProfileScope(profile: AgentProfileView, projects: ProjectDTO[]) {
  const project = projects.find((row) => row.id === profile.projectId);
  const environment = project?.environments.find((row) => row.id === profile.environmentId);
  return {
    project,
    environment,
    label: `${project?.name ?? "Projet indisponible"} · ${environment?.name ?? "Environnement indisponible"}`,
  };
}
