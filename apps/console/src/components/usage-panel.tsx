import {
  type OwnerSecurityView,
  type ProjectDTO,
  USAGE_CATEGORIES,
  type UsageOverviewView,
  type UsageResourcesView,
  type UsageSummaryView,
} from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { resource, timestamp } from "@/lib/api";
import { ownerAuth } from "@/lib/owner";
import { EmptyState, Failure, Loading } from "./shared";
import { TelemetryFilters } from "./telemetry-filters";
import { micros, queryString, useTelemetryMutation } from "./telemetry-shared";
import { Button } from "./ui/button";
import { BudgetForm, InvoiceForm, PriceForm } from "./usage-forms";

export function UsageTotals({ summary }: { summary: UsageSummaryView }) {
  return (
    <>
      <dl className="telemetry-totals">
        {(
          [
            ["Estimation tarifaire", summary.estimatedMicros],
            ["Rapporté par le fournisseur", summary.providerReportedMicros],
            ["Factures importées", summary.invoiceMicros],
            ["Charge conservatrice", summary.conservativeChargedMicros],
            ["Réservations", summary.reservedMicros],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{micros(value)}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        Complétude : {summary.completeness} · {summary.attemptCount} tentatives ·{" "}
        {summary.pendingCount} en attente · {summary.unknownCount} inconnues ·{" "}
        {summary.legacyRunCount} anciennes exécutions. Facturation administrateur non configurée.
      </p>
    </>
  );
}

export function UsagePanel() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState("");
  const query = queryString({ ...filters, cursor });
  const overview = useQuery(resource<UsageOverviewView>(`usage:${query}`, `/usage?${query}`));
  const resources = useQuery(resource<UsageResourcesView>("usage-resources", "/usage/resources"));
  const projects = useQuery(resource<ProjectDTO[]>("projects", "/projects"));
  const security = useQuery(resource<OwnerSecurityView>("owner-security", "/owner/security"));
  const mutation = useTelemetryMutation();
  const [identityError, setIdentityError] = useState<Error | null>(null);
  const filterPanel = (
    <section className="panel telemetry-section">
      <h2>Périmètre et période</h2>
      {projects.data ? (
        <TelemetryFilters
          key={JSON.stringify(filters)}
          projects={projects.data}
          values={filters}
          usage
          change={(next) => {
            setFilters(next);
            setCursor("");
          }}
        />
      ) : projects.isError ? (
        <Failure error={projects.error} />
      ) : (
        <Loading />
      )}
      <Button variant="outline" onClick={() => void overview.refetch()}>
        Actualiser la consommation
      </Button>
    </section>
  );
  if (!overview.data)
    return (
      <div className="telemetry-stack">
        {filterPanel}
        {overview.isError ? (
          <Failure error={overview.error} retry={() => void overview.refetch()} />
        ) : (
          <Loading />
        )}
      </div>
    );
  const data = overview.data;
  const disabled = mutation.isPending || overview.isError || projects.isError;
  return (
    <div className="telemetry-stack">
      {filterPanel}
      {overview.isError && <Failure error={overview.error} retry={() => void overview.refetch()} />}
      <section className="panel telemetry-section">
        <h2>Coûts distincts · USD exacts</h2>
        <UsageTotals summary={data.summary} />
        <p>
          Instantané : {timestamp(data.page.snapshotAt)}. Les totaux portent sur le périmètre
          filtré, pas uniquement cette page.
        </p>
        {(data.truncated || data.page.historyTruncated) && (
          <p role="status">
            Historique tronqué ; les données conservées ne représentent pas nécessairement toute la
            période.
            {data.page.retainedSince && ` Conservées depuis ${timestamp(data.page.retainedSince)}.`}
          </p>
        )}
      </section>
      <section className="panel telemetry-section">
        <h2>Tentatives · {data.page.total}</h2>
        <p>
          Catégories exclusives : input hors cache, output hors raisonnement. Les totaux bruts
          fournisseur sont affichés séparément.
        </p>
        {!data.attempts.length && (
          <EmptyState
            title="Aucune tentative dans ce périmètre"
            description="Changez les filtres ou attendez une exécution comptabilisée."
          />
        )}
        {data.attempts.map((a) => (
          <details className="telemetry-record" key={a.id}>
            <summary>
              {a.provider} · {a.model} · {a.completeness} · {micros(a.estimatedMicros)}
            </summary>
            <dl className="telemetry-totals">
              <div>
                <dt>Tentative</dt>
                <dd>{a.id}</dd>
              </div>
              <div>
                <dt>Exécution / tâche</dt>
                <dd>
                  {a.runId} / {a.taskId ?? "—"}
                </dd>
              </div>
              <div>
                <dt>Projet / environnement</dt>
                <dd>
                  {a.projectId} / {a.environmentId}
                </dd>
              </div>
              <div>
                <dt>Profil / runner / skill</dt>
                <dd>
                  {a.profileId ?? "—"} / {a.runner ?? "—"} / {a.skillId ?? "—"}
                </dd>
              </div>
              <div>
                <dt>Ascendance</dt>
                <dd>
                  {a.relation} · séquence {a.sequence} · parent {a.parentSequence ?? "—"}
                </dd>
              </div>
              <div>
                <dt>Preuve</dt>
                <dd>
                  {a.evidence} · {timestamp(a.intentAt)}
                </dd>
              </div>
              {USAGE_CATEGORIES.map((k) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{a.outcome?.categories[k] ?? "Inconnu"}</dd>
                </div>
              ))}
              <div>
                <dt>Totaux bruts input / output</dt>
                <dd>
                  {a.outcome?.reportedTotals?.input ?? "Inconnu"} /{" "}
                  {a.outcome?.reportedTotals?.output ?? "Inconnu"}
                </dd>
              </div>
              <div>
                <dt>Résultat / flux / TTL cache</dt>
                <dd>
                  {a.outcome?.state ?? "En attente"} /{" "}
                  {a.outcome ? String(a.outcome.streamed) : "Inconnu"} /{" "}
                  {a.outcome?.cacheWriteTtl ?? "Inconnu"}
                </dd>
              </div>
              <div>
                <dt>Requête fournisseur</dt>
                <dd>{a.outcome?.providerRequestId ?? "Inconnue"}</dd>
              </div>
              <div>
                <dt>Coût rapporté fournisseur</dt>
                <dd>{micros(a.outcome?.providerReportedMicros ?? null)}</dd>
              </div>
              <div>
                <dt>Révision tarifaire</dt>
                <dd>{a.priceId ?? "Inconnue"}</dd>
              </div>
            </dl>
            <Button
              variant="outline"
              onClick={() => {
                setFilters({
                  projectId: a.projectId,
                  environmentId: a.environmentId,
                  runId: a.runId,
                });
                setCursor("");
              }}
            >
              Filtrer cette exécution
            </Button>
          </details>
        ))}
        <div className="button-row">
          <Button variant="outline" disabled={!cursor} onClick={() => setCursor("")}>
            Première page
          </Button>
          <Button
            variant="outline"
            disabled={!data.page.nextCursor}
            onClick={() => setCursor(data.page.nextCursor ?? "")}
          >
            Page suivante des tentatives
          </Button>
        </div>
      </section>
      <section className="panel telemetry-section">
        <h2>Budgets et pression</h2>
        {!data.budgets.length && <p>Aucun budget dans ce périmètre.</p>}
        {data.budgets.map((b) => (
          <div className="telemetry-record" key={b.id}>
            <strong>
              {b.scope} · {b.scopeId} · {b.pressure}
            </strong>
            <p>
              Plafond {micros(b.limitMicros)} · dépensé {micros(b.spentMicros)} · réservé{" "}
              {micros(b.reservedMicros)}
            </p>
            <p>
              {b.activeRuns}/{b.maxConcurrent} simultanées · {b.windowRuns}/{b.maxRuns} exécutions
              sur {b.windowSeconds} s · révision {b.revision}
            </p>
          </div>
        ))}
        <Button
          variant="outline"
          onClick={async () => {
            setIdentityError(null);
            try {
              const result = await ownerAuth.signIn.passkey();
              if (result.error) throw new Error("La confirmation propriétaire a échoué.");
              await security.refetch();
            } catch (e) {
              setIdentityError(e instanceof Error ? e : new Error("Confirmation impossible."));
            }
          }}
        >
          Confirmer mon identité pour étendre les limites
        </Button>
        <p>
          {security.data?.fresh && !security.isError
            ? "Identité récemment confirmée."
            : "Identité récente non confirmée."}
        </p>
        {identityError && <Failure error={identityError} />}
      </section>
      {projects.data && (
        <BudgetForm
          budgets={data.budgets}
          projects={projects.data}
          disabled={disabled}
          fresh={security.data?.fresh === true && !security.isError}
          post={mutation.post}
        />
      )}
      <section className="panel telemetry-section">
        <h2>Catalogue tarifaire revu</h2>
        {!data.prices.length && (
          <p>Aucun tarif revu : les estimations manquantes restent inconnues.</p>
        )}
        {data.prices.map((p) => (
          <details className="telemetry-record" key={p.id}>
            <summary>
              {p.price.provider} · {p.price.model} · {p.price.revision} ·{" "}
              {Date.parse(p.price.expiresAt) <= Date.now() ? "Expiré" : "Revu"}
            </summary>
            <p>
              Source : {p.price.source} · revue {timestamp(p.price.reviewedAt)} · expiration{" "}
              {timestamp(p.price.expiresAt)} · TTL cache {p.price.cacheWriteTtl ?? "Non renseigné"}
            </p>
            {USAGE_CATEGORIES.map((k) => (
              <p key={k}>
                {k} : {micros(p.price.ratesMicrosPerMillion[k])} / million
              </p>
            ))}
          </details>
        ))}
      </section>
      <PriceForm post={mutation.post} disabled={disabled} />
      <section className="panel telemetry-section">
        <h2>Factures importées et écarts</h2>
        {!data.invoices.length && <p>Aucune facture importée.</p>}
        {data.invoices.map((invoice) => (
          <details key={invoice.id} className="telemetry-record">
            <summary>
              {invoice.invoice.invoiceId} · {invoice.invoice.source} · {invoice.invoice.provider}
            </summary>
            <p>
              {timestamp(invoice.invoice.periodStart)} — {timestamp(invoice.invoice.periodEnd)} ·
              importé {timestamp(invoice.importedAt)}
            </p>
            {invoice.invoice.lines.map((line) => (
              <p key={line.lineId}>
                {line.lineId} · tentative {line.attemptId ?? "Non liée"} ·{" "}
                {micros(line.amountMicros)}
              </p>
            ))}
            <h3>Historique de réconciliation</h3>
            {invoice.reconciliations.map((r) => (
              <p key={`${r.at}:${r.matched}:${r.unmatched}:${r.unknown}:${r.discrepancyMicros}`}>
                {timestamp(r.at)} · {r.matched} liées · {r.unmatched} non liées · {r.unknown}{" "}
                inconnues · écart {micros(r.discrepancyMicros)}
              </p>
            ))}
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() =>
                mutation.mutate({
                  path: `/usage/invoices/${invoice.id}/reconcile`,
                  body: {},
                  method: "POST",
                })
              }
            >
              Réconcilier la facture
            </Button>
          </details>
        ))}
      </section>
      {projects.data && (
        <InvoiceForm projects={projects.data} post={mutation.post} disabled={disabled} />
      )}
      {mutation.isError && <Failure error={mutation.error} />}
      <section className="panel telemetry-section">
        <h2>Ressources réellement observées</h2>
        <p>
          Mesures locales et appels d’outils ; les plafonds d’allocation ne sont pas des
          consommations. Cet inventaire est global, indépendant des filtres de tentatives.
        </p>
        {resources.isError ? (
          <Failure error={resources.error} retry={() => void resources.refetch()} />
        ) : !resources.data ? (
          <Loading />
        ) : (
          <>
            {resources.data.truncated && <p>Inventaire tronqué.</p>}
            {!resources.data.records.length && <p>Aucune mesure conservée.</p>}
            {resources.data.records.map((r) => (
              <div className="telemetry-record" key={r.id}>
                <strong>
                  {r.name} · {r.state} · {r.completeness}
                </strong>
                <p>
                  {r.projectId} / {r.environmentId} · exécution {r.runId}
                </p>
                <p>
                  {timestamp(r.occurredAt)} · {r.source}
                </p>
                <p>
                  {r.measurements.length
                    ? r.measurements.map((m) => `${m.value} ${m.unit}`).join(" · ")
                    : "Mesures inconnues"}
                </p>
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
