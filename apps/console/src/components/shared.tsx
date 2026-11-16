import { AlertCircle, ArrowUpRight, Check, CircleDashed, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
const stateLabels: Record<string, string> = {
  draft: "Brouillon",
  validated: "Configuration validée",
  suspended: "Suspendu",
  active: "Actif",
  purged: "Purgé",
  planned: "Prévu",
  local: "Local",
  unconfigured: "Non configuré",
  unqualified: "À qualifier",
  configured: "Configuré",
  succeeded: "Terminé",
  failed: "Échec",
  pending_verification: "Vérification en attente",
  queued: "En file",
  running: "En cours",
  superseded: "Remplacé",
  unavailable: "Indisponible",
  cancelled: "Annulé",
  reserved: "Réservé",
  ready: "Vérifié en service",
  unknown: "Résultat incertain",
  quarantined: "En quarantaine",
  expired: "Expiré",
  "backup-created": "Sauvegarde créée",
  "archive-healthy": "Archive vérifiée",
  "archive-checked": "Archive actualisée",
  "restore-verified": "Restauration vérifiée et isolée",
  stale: "Archive trop ancienne",
  released: "Réservation libérée",
};
export function Status({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={`state state-${value}`}>
      <span className="status-dot" />
      {stateLabels[value] ?? value}
    </Badge>
  );
}
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <CircleDashed size={28} strokeWidth={1.3} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={20} /> Chargement des données locales…
    </div>
  );
}
export function Failure({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="error-message" role="alert">
      <AlertCircle size={18} />
      <span>{error.message}</span>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}
export function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {count !== undefined && <span className="count">{count}</span>}
    </div>
  );
}
export function Step({
  title,
  description,
  done = false,
}: {
  title: string;
  description: string;
  done?: boolean;
}) {
  return (
    <div className="preparation-step">
      <span className={done ? "step-icon done" : "step-icon"}>
        {done ? <Check size={16} /> : <ArrowUpRight size={16} />}
      </span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <Status value={done ? "local" : "planned"} />
    </div>
  );
}
