import {
  type ApiErrorBody,
  CONTROL_API_HEADER,
  LOCAL_DEFAULTS,
  parseControlResponse,
} from "@godseye/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ownerAuthenticationRequired } from "./owner";

const messages: Record<string, string> = {
  SLUG_CONFLICT: "Cet identifiant de projet est déjà utilisé.",
  INVALID_INPUT: "Vérifiez les champs du formulaire.",
  BACKEND_HELD: "Cet environnement est suspendu ou protégé. Son backend ne peut pas être activé.",
  REVISION_CONFLICT: "Le projet a changé. Actualisez avant de réessayer.",
  CAPABILITY_UNAVAILABLE: "Ce service doit d’abord être connecté et qualifié.",
  NOT_FOUND: "Ce projet est introuvable.",
  UNAUTHENTICATED: "Connectez-vous avec votre clé d’accès propriétaire.",
  STEP_UP_REQUIRED: "Confirmez votre identité avec une clé d’accès avant cette action.",
  LAST_PASSKEY: "Ajoutez une autre clé d’accès avant de supprimer celle-ci.",
  NAME_CONFLICT: "Ce nom d’environnement existe déjà.",
  INVALID_EXPIRY: "Choisissez une expiration dans les trente prochains jours.",
  ENVIRONMENT_LIMIT: "Ce projet possède déjà huit aperçus persistants.",
  ENVIRONMENT_EXPIRED: "Cet aperçu a expiré. Modifiez sa date avant de continuer.",
  CAPACITY_EXCEEDED: "Les limites de l’environnement ou la capacité disponible sont dépassées.",
  ENVIRONMENT_ALLOCATED: "Cet environnement conserve une allocation active ou incertaine.",
  OBSERVATION_CHANGED: "Les mesures d’infrastructure ont changé. Préparez un nouveau profil.",
  PLAN_TAMPERED: "Le profil ne correspond plus à la demande approuvée.",
  INVALID_DATABASE_STATE: "L’état vérifié de la base ne permet pas cette action.",
  SOURCE_REQUIRED: "Associez un dépôt GitHub à ce projet avant de créer une politique.",
  SOURCE_UNAVAILABLE: "La vérification GitHub est indisponible. Aucun code n’a été autorisé.",
  SOURCE_REJECTED:
    "La source ne correspond pas au dépôt, à l’installation ou à la pull request autorisés.",
  STALE_HEAD: "La branche a changé. Synchronisez GitHub pour préparer la version actuelle.",
  POLICY_REVOKED: "Cette politique de livraison est révoquée ou expirée.",
  POLICY_STALE: "Le projet ou son association GitHub a changé. Enregistrez une nouvelle politique.",
  DELIVERY_BUSY: "Cet environnement conserve une livraison ou un résultat incertain à réconcilier.",
  DELIVERY_HOLD:
    "Cette preview est expirée ou en cours d’arrêt. Elle ne peut plus recevoir d’accès ordinaire.",
  PREVIEW_CLOSED: "Cette preview est expirée, fermée ou en cours de vérification.",
  PREVIEW_OPEN:
    "La pull request est actuellement ouverte. Son arrêt automatique n’est pas autorisé.",
  PREVIEW_LIMIT:
    "La limite de previews conserve aussi les cellules dont l’arrêt n’est pas confirmé.",
  MIGRATION_APPROVAL_REQUIRED:
    "Une migration destructive exige l’approbation exacte et récente du propriétaire.",
  MIGRATION_LOCKED:
    "Une migration de cet environnement est tenue ou incertaine. Réconciliez-la d’abord.",
  MIGRATION_NOT_BACKWARD_COMPATIBLE:
    "Retour d’image exclu : une migration ultérieure n’est pas rétrocompatible.",
  SCAN_GATE_FAILED: "L’analyse de sécurité dépasse le seuil de gravité de la politique.",
  ARTIFACT_REJECTED:
    "L’artefact ne satisfait pas les contrôles, la provenance ou la configuration actuels.",
  DEFINITION_PAUSED: "Ce job est en pause. Reprenez-le avant de le déclencher.",
  INVALID_CRON: "L’expression cron n’est pas un calendrier UTC valide.",
  INVALID_TRANSITION: "Cette exécution n’est plus modifiable dans son état actuel.",
  PROJECT_SUSPENDED: "Ce projet est suspendu. Aucun job ne peut y être enregistré ou démarré.",
  ROLLBACK_REJECTED: "Ce déploiement précédent n’est pas éligible à un retour d’image.",
  INVALID_LIFECYCLE: "L’état actuel du projet ne permet pas cette action.",
  EXPORT_REQUIRED: "Exportez d’abord la révision actuelle du projet avant la quarantaine.",
  LIFECYCLE_BLOCKED: "Des opérations non résolues bloquent cette étape. Réconciliez-les d’abord.",
  PROJECT_QUARANTINED: "Ce projet est en quarantaine ou purgé : ses réglages sont figés.",
  PURGE_BLOCKED:
    "La purge est refusée : délai de quarantaine en cours ou ressources physiques restantes.",
  SLUG_MISMATCH: "L’identifiant saisi ne correspond pas à ce projet.",
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${LOCAL_DEFAULTS.apiBase}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    if (response.status === 401) ownerAuthenticationRequired();
    const payload = (await response.json()) as ApiErrorBody;
    throw new Error(
      messages[payload.error.code] ?? "L’action n’a pas abouti. Réessayez ou consultez le journal.",
    );
  }
  return parseControlResponse<T>(
    init?.method ?? "GET",
    path,
    await response.json(),
    response.headers.get(CONTROL_API_HEADER) ?? "",
  );
}

export function resource<T>(key: string, path: string) {
  return queryOptions({
    queryKey: [key],
    queryFn: () => api<T>(path),
    enabled: typeof window !== "undefined",
    retry: 1,
  });
}

export function timestamp(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
