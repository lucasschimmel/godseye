import type { ServerObservationView } from "@godseye/contracts";

export const serverUnknownLabel = {
  NOT_CONFIGURED: "source non configurée",
  UNREADABLE: "source illisible depuis la VM",
  UNREACHABLE: "service injoignable",
  STALE: "mesure périmée",
  INVALID: "contenu invalide",
} as const satisfies Record<
  Extract<ServerObservationView["cpu"], { state: "unknown" }>["reason"],
  string
>;

export const hostStatusLabel = {
  ok: "Hôte sain",
  degraded: "Hôte dégradé",
  critical: "Hôte critique",
} as const;

export const serverAvailability = {
  host: "Le rapport de l’hôte n’est lisible qu’une fois copié dans la VM professionnelle.",
} as const;

/** Summary line for overview tiles from one filesystem entry. */
export function filesystemSummary(fs: ServerObservationView["filesystems"][number]): string {
  return fs.state === "observed" ? `${fs.usedPercent} % utilisé` : "Inconnu";
}
