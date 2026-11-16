import type { InfrastructureHeadroomView } from "@godseye/contracts";
import { Gauge, PauseCircle, PlayCircle } from "lucide-react";
import { useState } from "react";
import { SectionTitle } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { timestamp } from "@/lib/api";
import {
  headroomReason,
  headroomResources,
  headroomScopes,
  headroomUnits,
  pressureLabels,
} from "@/lib/infra-headroom-labels";

type Row = InfrastructureHeadroomView["scopes"][number]["resources"][number];
const amount = (value: number | null, unit: Row["unit"]) =>
  value === null ? "Inconnu" : `${value.toLocaleString("fr-FR")} ${headroomUnits[unit]}`;

interface Props {
  data: InfrastructureHeadroomView;
  fresh: boolean;
  busy: boolean;
  onAdmission: (state: "open" | "paused", reason?: string) => void;
}
export function InfrastructureHeadroomPanel({ data, fresh, busy, onAdmission }: Props) {
  const [reason, setReason] = useState("");
  const paused = data.admission.state === "paused";
  const queue = data.heavyQueue;
  return (
    <section className="panel" aria-labelledby="headroom-title">
      <div className="panel-heading">
        <SectionTitle>
          <span id="headroom-title">Marge et pression</span>
        </SectionTitle>
        <span className={`pressure-badge pressure-${data.pressure}`}>
          <Gauge size={14} /> Pression globale : {pressureLabels[data.pressure]}
        </span>
      </div>
      <p className="panel-note">
        Seuils : sous tension à {Math.round(data.thresholds.warn * 100)} % d’occupation (engagé plus
        réserve protégée), critique à {Math.round(data.thresholds.critical * 100)} %. Sans mesure
        fiable, l’état reste inconnu et jamais sain.
      </p>
      {data.scopes.map((scope) => (
        <div className="headroom-scope" key={scope.scope}>
          <h3>
            {headroomScopes[scope.scope]} · {pressureLabels[scope.pressure]}
          </h3>
          {/* The wide table scrolls sideways on narrow screens; keyboard users need to focus it. */}
          <section
            className="headroom-table-wrap"
            aria-label={`Tableau défilant : ${headroomScopes[scope.scope]}`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region must be keyboard reachable (WCAG 2.1.1)
            tabIndex={0}
          >
            <table className="headroom-table">
              <caption className="sr-only">{headroomScopes[scope.scope]}</caption>
              <thead>
                <tr>
                  <th scope="col">Ressource</th>
                  <th scope="col">Capacité</th>
                  <th scope="col">Engagé</th>
                  <th scope="col">Réserve protégée</th>
                  <th scope="col">Libre</th>
                  <th scope="col">État</th>
                </tr>
              </thead>
              <tbody>
                {scope.resources.map((row) => (
                  <tr key={row.resource} title={headroomReason(row.reason)}>
                    <th scope="row">{headroomResources[row.resource]}</th>
                    <td>{amount(row.capacity, row.unit)}</td>
                    <td>{amount(row.committed, row.unit)}</td>
                    <td>{amount(row.protectedReserve, row.unit)}</td>
                    <td>{amount(row.free, row.unit)}</td>
                    <td>
                      <span className={`pressure-badge pressure-${row.pressure}`}>
                        {pressureLabels[row.pressure]}
                      </span>
                      {row.reason && <small> {headroomReason(row.reason)}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      ))}
      <div className="headroom-queue">
        <h3>Tâches lourdes</h3>
        <p>
          {queue.running} en cours sur {queue.maxConcurrent} · {queue.queued} en attente sur{" "}
          {queue.maxQueued} ·{" "}
          {queue.full
            ? "File pleine : toute nouvelle tâche lourde est refusée."
            : "File disponible."}
        </p>
      </div>
      <div className="headroom-admission">
        <h3>{paused ? "Admission suspendue" : "Admission ouverte"}</h3>
        <p>
          {paused
            ? `Motif : ${data.admission.reason ?? "non renseigné"}${data.admission.updatedAt ? ` · ${timestamp(data.admission.updatedAt)}` : ""}. `
            : ""}
          La suspension bloque les nouvelles admissions. Les lectures, la réconciliation et les
          arrêts de protection continuent.
        </p>
        {paused ? (
          <Button disabled={busy || !fresh} onClick={() => onAdmission("open")}>
            <PlayCircle size={15} />
            Reprendre l’admission
          </Button>
        ) : (
          <form
            className="headroom-pause"
            onSubmit={(event) => {
              event.preventDefault();
              onAdmission("paused", reason.trim());
              setReason("");
            }}
          >
            <label>
              Motif de la suspension
              <input
                required
                minLength={3}
                maxLength={300}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <Button type="submit" variant="outline" disabled={busy || !fresh}>
              <PauseCircle size={15} />
              Suspendre l’admission
            </Button>
          </form>
        )}
        {!fresh && <p className="muted">Confirmez votre identité pour modifier l’admission.</p>}
      </div>
    </section>
  );
}
