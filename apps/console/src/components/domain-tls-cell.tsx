import type { DomainTlsView } from "@godseye/contracts";
import { Badge } from "@/components/ui/badge";

const DAY_MS = 86_400_000;
const reasonLabels: Record<NonNullable<DomainTlsView["reason"]>, string> = {
  PROBE_NOT_CONFIGURED: "Sonde TLS non configurée (mode local)",
  NOT_SERVED: "Domaine pas encore servi par le serveur d’entrée",
  DNS_NOT_EDGE: "Le DNS ne pointe pas vers le serveur d’entrée",
  DNS_UNAVAILABLE: "Résolution DNS indisponible",
  HANDSHAKE_FAILED: "Le serveur d’entrée n’a pas répondu au contrôle TLS",
  NO_CERTIFICATE: "Aucun certificat présenté",
};
const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** Whole days between two instants, rounded up so "dans 0 jour" never hides a still-valid certificate. */
export const daysUntil = (expiresAt: string, nowMs: number) =>
  Math.ceil((new Date(expiresAt).getTime() - nowMs) / DAY_MS);

/** Certificate expiry with a badge: warning inside 14 days, destructive once expired, never a guess. */
export function DomainTlsCell({ tls, nowMs }: { tls: DomainTlsView; nowMs: number }) {
  if (tls.state === "unknown" || !tls.expiresAt)
    return (
      <span className="muted" title={tls.reason ? reasonLabels[tls.reason] : undefined}>
        Inconnue{tls.reason ? ` · ${reasonLabels[tls.reason]}` : ""}
      </span>
    );
  const date = dateFormat.format(new Date(tls.expiresAt));
  const days = daysUntil(tls.expiresAt, nowMs);
  if (tls.state === "expired")
    return (
      <span>
        <Badge variant="destructive">Expiré</Badge> <span className="mono">{date}</span>
      </span>
    );
  if (tls.state === "expiring")
    return (
      <span>
        <Badge variant="secondary">Expire bientôt</Badge> <span className="mono">{date}</span> (
        {days} {days > 1 ? "jours" : "jour"})
      </span>
    );
  return (
    <span>
      <Badge variant="outline">Valide</Badge> <span className="mono">{date}</span>
    </span>
  );
}
