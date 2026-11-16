import type { OperationalOverviewView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { resource, timestamp } from "@/lib/api";
import { Failure, Loading } from "./shared";
import { Button } from "./ui/button";
import { UsageTotals } from "./usage-panel";

export function OperationalOverview() {
  const overview = useQuery(
    resource<OperationalOverviewView>("operational-overview", "/overview/operational"),
  );
  if (!overview.data)
    return overview.isError ? (
      <Failure error={overview.error} retry={() => void overview.refetch()} />
    ) : (
      <Loading />
    );
  const data = overview.data;
  return (
    <section className="panel telemetry-section" aria-label="Situation opérationnelle">
      <div className="panel-heading">
        <h2>Situation opérationnelle locale</h2>
        <Button variant="outline" onClick={() => void overview.refetch()}>
          Actualiser la situation
        </Button>
      </div>
      {overview.isError && <Failure error={overview.error} retry={() => void overview.refetch()} />}
      <p>
        Collectée le {timestamp(data.collectedAt)}. Le serveur distant reste non connecté ; ces
        observations concernent le contrôleur et ses journaux locaux.
      </p>
      <dl className="telemetry-totals">
        <div>
          <dt>Projets / environnements</dt>
          <dd>
            {data.projectCount} / {data.environmentCount}
          </dd>
        </div>
        <div>
          <dt>Exécutions actives</dt>
          <dd>{data.activeRuns}</dd>
        </div>
        <div>
          <dt>Décisions en attente</dt>
          <dd>
            {data.pendingDecisions} · Foundation {data.decisionCounts.foundation} · orchestration{" "}
            {data.decisionCounts.orchestration} · chat {data.decisionCounts.chat}
          </dd>
        </div>
        <div>
          <dt>Jobs</dt>
          <dd>
            {data.jobs.queued} en file · {data.jobs.active} actifs · {data.jobs.unknown} inconnus
          </dd>
        </div>
        <div>
          <dt>Incidents actifs</dt>
          <dd>{data.activeIncidents}</dd>
        </div>
        <div>
          <dt>Sources périmées / indisponibles</dt>
          <dd>
            {data.pressure.staleSources} / {data.pressure.unavailableSources}
          </dd>
        </div>
        <div>
          <dt>Pression des ressources</dt>
          <dd>
            {data.resourcePressure
              ? `${data.resourcePressure.pressure} · observation ${data.resourcePressure.observationState}`
              : "Inconnue"}
          </dd>
        </div>
        <div>
          <dt>Observateur externe</dt>
          <dd>{data.health.externalObserver === "configured" ? "Configuré" : "Non configuré"}</dd>
        </div>
      </dl>
      {data.usage ? (
        <UsageTotals summary={data.usage} />
      ) : (
        <p>Consommation inconnue : aucune synthèse disponible.</p>
      )}
      <div className="button-row">
        <Link className="text-link" to="/usage">
          Consommation et budgets
        </Link>
        <Link className="text-link" to="/observability" hash="incidents">
          Observations et incidents
        </Link>
        <Link className="text-link" to="/jobs">
          Jobs
        </Link>
        <Link className="text-link" to="/agents">
          Décisions Hermès
        </Link>
        <Link className="text-link" to="/infrastructure">
          Pression et infrastructure
        </Link>
      </div>
    </section>
  );
}
