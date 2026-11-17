import type { AuditView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { HermesMark } from "@/components/ds/viz";
import { JournalOperations } from "@/components/journal-operations";
import { ObservabilityPanel } from "@/components/observability-panel";
import { useOwner } from "@/components/owner-gate";
import { Failure, Loading, PageHeading } from "@/components/shared";
import { resource } from "@/lib/api";

const VIEWS = {
  chronologie: "Chronologie",
  operations: "Opérations",
  observabilite: "Incidents et télémétrie",
} as const;
type JournalView = keyof typeof VIEWS;

export const Route = createFileRoute("/journal")({
  validateSearch: (search: Record<string, unknown>): { vue?: JournalView } => ({
    vue:
      typeof search.vue === "string" && search.vue in VIEWS
        ? (search.vue as JournalView)
        : undefined,
  }),
  component: Journal,
});

const dayFormat = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const timeFormat = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return "Aujourd’hui";
  if (date.toDateString() === yesterday.toDateString()) return "Hier";
  const label = dayFormat.format(date);
  return label.charAt(0).toLocaleUpperCase("fr") + label.slice(1);
}

function Actor({ actorId, ownerId }: { actorId: string; ownerId: string }) {
  if (actorId === ownerId)
    return (
      <span className="avatar sm me" title="Vous">
        VO
      </span>
    );
  if (/hermes|agent/i.test(actorId)) return <HermesMark size={24} />;
  return (
    <span className="avatar sm" title={actorId}>
      {actorId
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 2)
        .toLocaleUpperCase("fr") || "SY"}
    </span>
  );
}

function Chronology() {
  const { status } = useOwner();
  const audit = useQuery(resource<AuditView[]>("audit", "/audit"));
  const [category, setCategory] = useState("all");
  const [text, setText] = useState("");
  const categories = useMemo(
    () =>
      [
        ...new Set((audit.data ?? []).map((entry) => entry.action.split(".")[0] ?? entry.action)),
      ].sort(),
    [audit.data],
  );
  if (audit.isError) return <Failure error={audit.error} retry={() => void audit.refetch()} />;
  if (!audit.data) return <Loading />;
  const now = new Date();
  const needle = text.trim().toLocaleLowerCase("fr");
  const entries = audit.data.filter(
    (entry) =>
      (category === "all" ||
        entry.action.startsWith(`${category}.`) ||
        entry.action === category) &&
      (!needle ||
        `${entry.action} ${entry.summary} ${entry.actorId}`
          .toLocaleLowerCase("fr")
          .includes(needle)),
  );
  const days = new Map<string, AuditView[]>();
  for (const entry of entries) {
    const label = dayLabel(entry.occurredAt, now);
    days.set(label, [...(days.get(label) ?? []), entry]);
  }
  return (
    <>
      <div className="toolbar">
        <div className="seg">
          <button
            type="button"
            aria-pressed={category === "all"}
            onClick={() => setCategory("all")}
          >
            Tout
          </button>
          {categories.map((name) => (
            <button
              type="button"
              key={name}
              aria-pressed={category === name}
              onClick={() => setCategory(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <label className="search-pill">
          <Search size={14} />
          <span className="sr-only">Filtrer le journal</span>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Action, résumé, acteur…"
          />
        </label>
      </div>
      {!entries.length && (
        <p className="faint">
          {audit.data.length
            ? "Aucun événement ne correspond au filtre."
            : "Le journal est vide pour le moment."}
        </p>
      )}
      {[...days.entries()].map(([day, rows]) => (
        <section className="day" key={day} aria-label={day}>
          <h2 className="day-title">
            {day}
            <span className="mono faint">{rows.length}</span>
          </h2>
          <ol className="ledger">
            {rows.map((entry) => (
              <li key={entry.id}>
                <time className="mono faint" dateTime={entry.occurredAt}>
                  {timeFormat.format(new Date(entry.occurredAt))}
                </time>
                <span className="ledger-node">
                  <Actor actorId={entry.actorId} ownerId={status.owner.id} />
                </span>
                <div>
                  <span className="ledger-line">{entry.summary || entry.action}</span>
                  <span className="ledger-tags">
                    <span className="tag mono">{entry.action}</span>
                    <span className="mono faint">#{entry.sequence}</span>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

function Journal() {
  const { vue = "chronologie" } = Route.useSearch();
  return (
    <>
      <PageHeading
        eyebrow="Suivi"
        title="Journal"
        description="Audit, opérations, incidents et télémétrie : ce qui s’est passé, qui l’a fait, et ce qui reste inconnu."
      />
      <nav className="seg page-tabs" aria-label="Vues du journal">
        {(Object.keys(VIEWS) as JournalView[]).map((key) => (
          <Link
            key={key}
            to="/journal"
            search={{ vue: key }}
            aria-current={vue === key ? "page" : undefined}
          >
            {VIEWS[key]}
          </Link>
        ))}
      </nav>
      {vue === "chronologie" && <Chronology />}
      {vue === "operations" && <JournalOperations />}
      {vue === "observabilite" && <ObservabilityPanel />}
    </>
  );
}
