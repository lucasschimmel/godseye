export const providerLabels: Record<string, string> = {
  unconfigured: "OpenBao non configuré",
  ready: "OpenBao disponible",
  sealed: "OpenBao scellé",
  uninitialized: "OpenBao non initialisé",
  no_authority: "OpenBao répond, sans identité pour le contrôleur",
  unauthorized: "Autorité OpenBao refusée",
  unavailable: "OpenBao indisponible",
  invalid: "Réponse OpenBao invalide",
};
export const purposeLabels: Record<string, string> = {
  runtime: "Application",
  migration: "Migration",
  deploy: "Déploiement",
  backup: "Sauvegarde",
};
export const states: Record<string, string> = {
  empty: "Vide",
  staged: "Candidat préparé",
  active: "Actif",
  unknown: "À réconcilier",
  pending: "En attente",
  succeeded: "Terminé",
  failed: "Échec",
  revoked: "Révoqué",
};
