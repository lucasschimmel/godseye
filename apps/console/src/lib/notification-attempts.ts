import type { NotificationAttemptView } from "@godseye/contracts";

export const failureLabels: Record<NonNullable<NotificationAttemptView["reason"]>, string> = {
  TARGET_BLOCKED: "adresse refusée (réseau privé ou non public)",
  DNS_FAILED: "nom de domaine introuvable",
  CONNECTION_FAILED: "connexion impossible",
  TLS_FAILED: "certificat ou connexion TLS refusés",
  TIMED_OUT: "délai dépassé",
  REJECTED: "le récepteur a refusé la requête",
  REDIRECT_REFUSED: "redirection refusée",
  SERVER_ERROR: "erreur côté récepteur",
  NO_CONFIRMATION: "aucune confirmation exploitable",
};
const when = (at: string | null) =>
  at
    ? new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(at))
    : "";

/**
 * Plain-language outcome of one send. "Confirmé" is used only for a 2xx answer the adapter
 * actually received; it proves reception by the endpoint, not that a person read the message.
 */
export function attemptText(attempt: NotificationAttemptView, subject: "test" | "incident") {
  const noun = subject === "test" ? "test d’arrivée" : "envoi d’incident";
  const reason = attempt.reason ? failureLabels[attempt.reason] : "cause inconnue";
  switch (attempt.state) {
    case "never":
      return subject === "test" ? "Jamais testé." : "Aucun incident envoyé par ce canal.";
    case "confirmed":
      return `Dernier ${noun} confirmé le ${when(attempt.at)} : le récepteur a répondu HTTP ${attempt.httpStatus ?? "2xx"}. Cela prouve la réception par ce service, pas qu’une personne l’a lue.`;
    case "failed":
      return `Dernier ${noun} en échec le ${when(attempt.at)} : ${reason}${attempt.httpStatus ? ` (HTTP ${attempt.httpStatus})` : ""}. Rien n’a été confirmé.`;
    case "unknown":
      return `Résultat du dernier ${noun} inconnu (${when(attempt.at)}) : ${reason}. L’envoi a peut-être atteint le récepteur ; rien n’est confirmé.`;
  }
}
