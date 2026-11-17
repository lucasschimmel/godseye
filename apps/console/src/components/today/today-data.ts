import type {
  IncidentOverviewView,
  OperationalOverviewView,
  OrchestrationDetailView,
  ProjectView,
} from "@godseye/contracts";
import { relativeTime } from "@/lib/server-metrics";
import type { RibbonEvent } from "./day-ribbon";

export interface Decision {
  id: string;
  kind: string;
  icon: "plan" | "question" | "chat" | "approval" | "preview";
  title: string;
  scope: string;
  facts: string[];
  due: string | null;
  urgent: boolean;
  action: string;
  to: string;
  search?: Record<string, string>;
  params?: Record<string, string>;
}

const HOUR = 3_600_000;

export function scopeLabel(
  projects: ProjectView[],
  projectId: string,
  environmentId?: string | null,
) {
  const project = projects.find((p) => p.id === projectId);
  const environment = project?.environments.find((e) => e.id === environmentId);
  return [project?.slug ?? "projet inconnu", environment?.name].filter(Boolean).join(" · ");
}

export function dollars(micros: number | null | undefined, digits = 2): string {
  if (micros === null || micros === undefined) return "—";
  return `${(micros / 1_000_000).toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} $`;
}

/** Everything that waits for the owner, most urgent first. */
export function buildDecisions(
  plans: OrchestrationDetailView[],
  operational: OperationalOverviewView | undefined,
  projects: ProjectView[],
  now: number,
): Decision[] {
  const items: Decision[] = [];
  for (const detail of plans) {
    if (detail.state !== "pending" && detail.state !== "waiting_clarification") continue;
    const left = new Date(detail.plan.expiresAt).getTime() - now;
    const question = detail.state === "waiting_clarification";
    items.push({
      id: `plan-${detail.plan.id}`,
      kind: question ? "Question d’Hermes" : "Plan Hermes",
      icon: question ? "question" : "plan",
      title: detail.plan.title || "Plan sans titre",
      scope: scopeLabel(projects, detail.plan.projectId, detail.plan.environmentId),
      facts: [
        `${detail.plan.steps.length} étape${detail.plan.steps.length > 1 ? "s" : ""}`,
        `${dollars(detail.plan.maxCostMicros)} max`,
        `empreinte ${detail.plan.hash.slice(0, 6)}`,
      ],
      due: `expire ${relativeTime(detail.plan.expiresAt, now)}`,
      urgent: left < 6 * HOUR,
      action: question ? "Répondre" : "Examiner",
      to: "/hermes",
      search: { vue: "plans" },
    });
  }
  for (const project of projects) {
    for (const environment of project.environments) {
      if (!environment.expiresAt || environment.status === "expired") continue;
      const left = new Date(environment.expiresAt).getTime() - now;
      if (left <= 0 || left > 24 * HOUR) continue;
      items.push({
        id: `preview-${environment.id}`,
        kind: "Preview",
        icon: "preview",
        title: `${environment.name} sera arrêtée`,
        scope: `${project.slug} · ${environment.name}`,
        facts: ["aucune purge sans nouvelle approbation"],
        due: relativeTime(environment.expiresAt, now),
        urgent: left < 6 * HOUR,
        action: "Ouvrir",
        to: "/projects/$projectId",
        params: { projectId: project.id },
      });
    }
  }
  const chat = operational?.decisionCounts.chat ?? 0;
  if (chat > 0)
    items.push({
      id: "chat-proposals",
      kind: "Conversation",
      icon: "chat",
      title: `${chat} proposition${chat > 1 ? "s" : ""} de conversation à valider`,
      scope: "Hermes",
      facts: ["plans proposés depuis une conversation"],
      due: null,
      urgent: false,
      action: "Voir",
      to: "/hermes",
      search: { vue: "conversations" },
    });
  const foundation = operational?.decisionCounts.foundation ?? 0;
  if (foundation > 0)
    items.push({
      id: "foundation-decisions",
      kind: "Exécution",
      icon: "approval",
      title: `${foundation} demande${foundation > 1 ? "s" : ""} d’approbation d’exécution`,
      scope: "Hermes · tâches",
      facts: ["réservation ou effet en attente"],
      due: null,
      urgent: false,
      action: "Voir",
      to: "/hermes",
      search: { vue: "taches" },
    });
  return items.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

export function openIncidents(overview: IncidentOverviewView | undefined) {
  return (overview?.incidents ?? [])
    .filter((incident) => incident.state !== "resolved" && !incident.muted)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

export function ribbonEvents(
  activity: { id: string; action: string; summary: string; occurredAt: string }[],
  incidents: ReturnType<typeof openIncidents>,
  plans: OrchestrationDetailView[],
  projects: ProjectView[],
): RibbonEvent[] {
  return [
    ...activity.map((entry) => ({
      id: `audit-${entry.id}`,
      at: new Date(entry.occurredAt),
      label: entry.summary || entry.action,
      tone: "ok" as const,
    })),
    ...incidents
      .filter((incident) => incident.delivery.lastAttemptAt)
      .map((incident) => ({
        id: `incident-${incident.id}`,
        at: new Date(incident.delivery.lastAttemptAt ?? ""),
        label: incident.summary,
        tone: "danger" as const,
      })),
    ...plans
      .filter((detail) => detail.state === "pending")
      .map((detail) => ({
        id: `expiry-${detail.plan.id}`,
        at: new Date(detail.plan.expiresAt),
        label: `Expiration du plan « ${detail.plan.title} »`,
        tone: "due" as const,
      })),
    ...projects.flatMap((project) =>
      project.environments
        .filter((environment) => environment.expiresAt)
        .map((environment) => ({
          id: `env-${environment.id}`,
          at: new Date(environment.expiresAt ?? ""),
          label: `Expiration de ${project.slug} · ${environment.name}`,
          tone: "due" as const,
        })),
    ),
  ];
}
