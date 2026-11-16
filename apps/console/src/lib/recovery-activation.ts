import type { ActivateRestoreInput, ActivationAssessmentView } from "@godseye/contracts";

export const activationBlockerLabels: Record<ActivationAssessmentView["reasons"][number], string> =
  {
    RESTORE_NOT_VERIFIED: "La restauration physique n’est pas encore vérifiée.",
    PROJECT_NOT_ACTIVE: "Le projet est suspendu ou en suppression : reprenez-le d’abord.",
    SOURCE_NOT_ACTIVE: "L’environnement source n’est plus actif ou déjà isolé.",
    SOURCE_WORK_IN_FLIGHT:
      "La source a encore du travail en cours : arrêtez-le ou rapprochez-le avant de continuer.",
    UNRECONCILED_EFFECTS:
      "La source a des effets non résolus : rapprochez-les avant toute activation.",
    PROMOTION_UNAVAILABLE:
      "Aucun fournisseur ne sait promouvoir cette base restaurée : l’activation reste bloquée.",
  };

export const acknowledgementLabels: Record<
  ActivationAssessmentView["requiredAcknowledgements"][number],
  string
> = {
  FILES_SNAPSHOT_MISSING: "Les fichiers ne sont pas restaurés (aucun instantané).",
  AUTH_SNAPSHOT_MISSING: "Les identités et sessions applicatives ne sont pas restaurées.",
  CONFIG_SNAPSHOT_MISSING: "La configuration applicative n’est pas restaurée.",
  NON_REWOUND_BUSINESS_EFFECT_COVERAGE_UNQUALIFIED:
    "Les effets métier postérieurs au point de restauration ne sont pas couverts ; ils ne seront pas rejoués.",
};

export interface ActivationFormState {
  assessment: Pick<ActivationAssessmentView, "activation" | "requiredAcknowledgements">;
  environmentName: string;
  typedName: string;
  acknowledged: readonly string[];
  fresh: boolean;
}

/** The form can submit only when the platform says ready, the step-up is fresh and every box is checked. */
export function activationSubmittable(state: ActivationFormState) {
  return (
    state.assessment.activation === "ready" &&
    state.fresh &&
    state.typedName === state.environmentName &&
    state.assessment.requiredAcknowledgements.every((item) => state.acknowledged.includes(item))
  );
}

export function activationRequest(
  assessment: Pick<ActivationAssessmentView, "requiredAcknowledgements">,
  revisions: { project: number; environment: number },
  environmentName: string,
): ActivateRestoreInput {
  return {
    expectedProjectRevision: revisions.project,
    expectedEnvironmentRevision: revisions.environment,
    confirmName: environmentName,
    acknowledged: [...assessment.requiredAcknowledgements],
  };
}
