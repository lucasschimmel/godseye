import type { InfrastructureOverviewView } from "@godseye/contracts";

/** What the headroom panel can honestly show: the table, or the one step that makes it meaningful. */
export type HeadroomEvidence = "table" | "declare" | "measure";

export const headroomCallToAction = {
  declare: "Déclarez la topologie réelle pour activer la marge et la pression",
  measure: "Actualisez les mesures pour activer la marge et la pression",
} as const;

export const headroomCallToActionDetail = {
  declare:
    "La marge compare l’engagé à la capacité déclarée : sans inventaire souhaité, aucun pourcentage n’a de sens et rien n’est estimé. Les mesures réelles du serveur restent affichées dans le panneau Serveur ci-dessus ; les valeurs proposées plus bas viennent des relevés du serveur et ne sont enregistrées qu’après votre confirmation.",
  measure:
    "La topologie est déclarée, mais aucune mesure fiable et récente de la VM professionnelle n’est enregistrée pour calculer la marge. Utilisez « Actualiser les mesures » (identité confirmée requise).",
} as const;

/**
 * On the server, a table made only of unknown values adds nothing to the measured Server panel, so it is
 * replaced by the single missing step. In local mode the table is kept as is.
 */
export function headroomEvidence(
  isServer: boolean,
  overview: Pick<InfrastructureOverviewView, "desired" | "observationState">,
): HeadroomEvidence {
  if (!isServer) return "table";
  if (!overview.desired) return "declare";
  return overview.observationState === "observed" ? "table" : "measure";
}

export const collectedMeasuresServerNote =
  "Aucun relevé de capacité n’a encore été enregistré pour le calcul de marge. Les mesures en direct de la VM professionnelle figurent dans le panneau Serveur ci-dessus ; « Actualiser les mesures » enregistre un relevé utilisable par la marge et l’admission.";
