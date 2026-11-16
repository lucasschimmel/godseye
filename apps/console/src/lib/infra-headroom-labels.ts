import type { InfrastructureHeadroomView } from "@godseye/contracts";

type Scopes = InfrastructureHeadroomView["scopes"][number];
type Row = Scopes["resources"][number];

export const pressureLabels: Record<InfrastructureHeadroomView["pressure"], string> = {
  ok: "Normal",
  warn: "Sous tension",
  critical: "Critique",
  unknown: "Inconnu",
};
export const headroomScopes: Record<Scopes["scope"], string> = {
  host: "Hôte physique",
  pool: "Pool de la VM professionnelle",
};
export const headroomResources: Record<Row["resource"], string> = {
  cpu: "CPU",
  memory: "Mémoire",
  disk: "Stockage des données",
  wal: "WAL (inclus dans le stockage)",
  pids: "Processus (PID)",
};
export const headroomUnits: Record<Row["unit"], string> = {
  milliCores: "millicœurs",
  MiB: "MiB",
  GiB: "GiB",
  count: "",
};
const reasons: Record<string, string> = {
  "Desired inventory is not declared": "Inventaire souhaité non déclaré.",
  "No trusted observation is available": "Aucune mesure fiable.",
  "The observation is stale": "Mesures périmées.",
  "The observation is not from the professional VM":
    "Les mesures ne viennent pas de la VM professionnelle.",
  "Physical host capacity is not observed": "Capacité du serveur physique non mesurée.",
  "Not measured by the collector": "Non mesuré par le collecteur.",
  "Capacity is not measured": "Capacité non mesurée.",
};
export function headroomReason(reason: string | null): string {
  return reason ? (reasons[reason] ?? "Mesure indisponible.") : "";
}
