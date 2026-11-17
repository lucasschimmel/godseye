import { AlertCircle, ArrowUpRight, Check, CircleDashed, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { isStepUpRequired } from "@/lib/api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="hero">
      <div>
        {eyebrow && <p className="hero-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="hero-lede">{description}</p>}
      </div>
      {action && <div className="hero-actions">{action}</div>}
    </header>
  );
}
/** Heading of a section that sits inside a page (settings tabs, journal views): an h2, not an h1. */
export function SubHeading({
  title,
  description,
  action,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="sub-hero">
      <div>
        <h2>{title}</h2>
        {description && <p className="dim">{description}</p>}
      </div>
      {action && <div className="hero-actions">{action}</div>}
    </header>
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
const stateTones: Record<string, string> = {
  active: "ok",
  succeeded: "ok",
  ready: "ok",
  configured: "ok",
  validated: "ok",
  "restore-verified": "ok",
  "archive-healthy": "ok",
  "backup-created": "ok",
  running: "warn",
  queued: "warn",
  pending_verification: "warn",
  unqualified: "warn",
  suspended: "warn",
  stale: "warn",
  failed: "danger",
  quarantined: "danger",
  unavailable: "danger",
  unknown: "unk",
  planned: "decl",
  draft: "decl",
  local: "decl",
  unconfigured: "decl",
  reserved: "decl",
};
export function statusTone(value: string): string {
  return stateTones[value] ?? "muted";
}
export function statusLabel(value: string): string {
  return stateLabels[value] ?? value;
}
export function Status({ value }: { value: string }) {
  const tone = statusTone(value);
  return (
    <Badge variant="outline" className={`state state-${value} pill-status ${tone}`}>
      <span className={`dot ${tone}`} aria-hidden="true" />
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
      <LoaderCircle className="spin" size={20} /> Chargement des données…
    </div>
  );
}
export function Failure({ error, retry }: { error: Error; retry?: () => void }) {
  // A missing step-up is handled by the shell's passkey sheet, not shown as a failure.
  if (isStepUpRequired(error)) return null;
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
