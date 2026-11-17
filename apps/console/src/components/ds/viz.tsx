import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** What a value is worth: measured, declared/planned, estimated, unknown, or failing. */
export type TruthKind = "obs" | "decl" | "est" | "unk" | "danger";

const TRUTH_LABEL: Record<TruthKind, string> = {
  obs: "observé",
  decl: "déclaré",
  est: "estimé",
  unk: "inconnu",
  danger: "en défaut",
};

export function Truth({ kind, children }: { kind: TruthKind; children?: ReactNode }) {
  return (
    <span className="truth-wrap" title={TRUTH_LABEL[kind]}>
      <span className={`truth ${kind}`} aria-hidden="true" />
      {children ?? <span className="sr-only">{TRUTH_LABEL[kind]}</span>}
    </span>
  );
}

export type Tone = "ok" | "warn" | "danger" | "decl" | "unk" | "muted";

export function Dot({ tone }: { tone: Tone }) {
  return <span className={`dot ${tone}`} aria-hidden="true" />;
}

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`pill-status ${tone}`}>
      <Dot tone={tone} />
      {children}
    </span>
  );
}

const fr = (value: number, digits = 0) =>
  value.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Value against a ceiling, with the 80 % headroom tick. */
export function Meter({
  used,
  max,
  unit,
  kind = "obs",
  digits = 0,
  label,
}: {
  used: number | null;
  max: number;
  unit: string;
  kind?: TruthKind;
  digits?: number;
  label?: string;
}) {
  if (used === null || max <= 0)
    return (
      <div className="meter unk">
        <div className="meter-bar" />
        <div className="meter-text">
          <Truth kind="unk">{label ?? "Inconnu"}</Truth>
        </div>
      </div>
    );
  const pct = Math.round((used / max) * 100);
  return (
    <div className={cn("meter", kind, pct >= 80 && "hot")}>
      <div className="meter-bar" aria-hidden="true">
        <span style={{ width: `${Math.min(pct, 100)}%` }} />
        <i style={{ left: "80%" }} />
      </div>
      <div className="meter-text">
        <Truth kind={kind} />
        <span className="mono">
          {fr(used, digits)} / {fr(max, digits)} {unit}
        </span>
        <span className="mono meter-pct">{pct} %</span>
      </div>
    </div>
  );
}

export function Ring({
  pct,
  size = 44,
  children,
  hot,
  label,
}: {
  pct: number;
  size?: number;
  children?: ReactNode;
  hot?: boolean;
  label?: string;
}) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(pct, 100)) / 100);
  return (
    <span
      className={cn("ring", (hot ?? pct >= 80) && "hot")}
      style={{ width: size, height: size } as CSSProperties}
      title={label}
    >
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r={r} className="track" />
        <circle
          cx="22"
          cy="22"
          r={r}
          className="value"
          strokeDasharray={c.toFixed(2)}
          strokeDashoffset={offset.toFixed(2)}
        />
      </svg>
      <span>{children}</span>
    </span>
  );
}

/** Ordered step progress: done steps solid, the running one amber. */
export function StepsBar({
  total,
  done,
  running,
}: {
  total: number;
  done: number;
  running: boolean;
}) {
  return (
    <span className="steps-bar" aria-hidden="true">
      {Array.from({ length: total }, (_, index) => (
        <i
          // biome-ignore lint/suspicious/noArrayIndexKey: positional segments have no identity.
          key={index}
          className={index < done ? "done" : index === done && running ? "run" : ""}
        />
      ))}
    </span>
  );
}

/** The Hermes mark: the agent avatar, always on the accent. */
export function HermesMark({ size = 28 }: { size?: number }) {
  return (
    <span className="hermes-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width={size * 0.6}
        height={size * 0.6}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <path d="M5 18 12 6l7 12" />
        <path d="M8.5 12h7" />
        <path d="M3 9c2 0 3.5-1 4.5-3M21 9c-2 0-3.5-1-4.5-3" />
      </svg>
    </span>
  );
}

export function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle cx="12" cy="12" r="2.8" fill="currentColor" />
    </svg>
  );
}

export { fr as formatNumber };
