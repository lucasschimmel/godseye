import type { EnvironmentView, ProjectView } from "@godseye/contracts";
import type { Tone } from "@/components/ds/viz";

export const ENVIRONMENT_STATUS_LABEL: Record<EnvironmentView["status"], string> = {
  planned: "prévu",
  reserved: "réservé",
  ready: "en service",
  suspended: "suspendu",
  unknown: "état inconnu",
  quarantined: "en quarantaine",
  expired: "expiré",
};

export function environmentTone(status: EnvironmentView["status"]): Tone {
  if (status === "ready") return "ok";
  if (status === "unknown") return "unk";
  if (status === "suspended") return "warn";
  if (status === "quarantined") return "danger";
  return "decl";
}

/** One project-level state: the weakest environment wins; nothing provisioned reads as declared. */
export function projectState(project: ProjectView): { tone: Tone; label: string } {
  if (project.status === "suspended") return { tone: "warn", label: "Suspendu" };
  const tones = project.environments.map((environment) => environmentTone(environment.status));
  if (tones.includes("danger")) return { tone: "danger", label: "Quarantaine" };
  if (tones.includes("unk")) return { tone: "unk", label: "À réconcilier" };
  if (tones.includes("warn")) return { tone: "warn", label: "Dégradé" };
  if (tones.includes("ok")) return { tone: "ok", label: "En service" };
  return {
    tone: "decl",
    label: project.status === "validated" ? "Validé, non provisionné" : "Brouillon",
  };
}

export const PROJECT_KIND_LABEL: Record<ProjectView["kind"], string> = {
  web: "Application web",
  api: "API",
  worker: "Worker",
};
