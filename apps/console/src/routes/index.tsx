import type {
  AgentOverviewView,
  IncidentOverviewView,
  OperationalOverviewView,
  OrchestrationOverviewView,
  Overview,
  ProjectView,
  ServerObservationView,
} from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CircleHelp,
  Clock,
  KeyRound,
  Layers,
  MessageSquare,
  Plus,
} from "lucide-react";
import { HermesMark, Meter, StatusPill, StepsBar, Truth } from "@/components/ds/viz";
import { Failure, Loading } from "@/components/shared";
import { DayRibbon } from "@/components/today/day-ribbon";
import {
  buildDecisions,
  type Decision,
  dollars,
  openIncidents,
  ribbonEvents,
  scopeLabel,
} from "@/components/today/today-data";
import { Button } from "@/components/ui/button";
import { resource } from "@/lib/api";
import { cpuLoadPercent, memoryUsedPercent, relativeTime, uptimeLabel } from "@/lib/server-metrics";

export const Route = createFileRoute("/")({ component: Today });

const DECISION_ICONS = {
  plan: Layers,
  question: CircleHelp,
  chat: MessageSquare,
  approval: KeyRound,
  preview: Clock,
} as const;

const ACTIVE_TASKS = new Set(["queued", "running", "cancel_requested"]);

function DecisionRow({ decision }: { decision: Decision }) {
  const Icon = DECISION_ICONS[decision.icon];
  return (
    <li className={`decision ${decision.urgent ? "urgent" : ""}`}>
      <span className="tile">
        <Icon size={17} />
      </span>
      <div className="decision-main">
        <div className="decision-meta">
          <span>{decision.kind}</span>
          <span className="mono faint">{decision.scope}</span>
        </div>
        <strong>{decision.title}</strong>
        <div className="facts">
          {decision.facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
          {decision.due && (
            <span className={`due ${decision.urgent ? "urgent" : ""}`}>
              <Clock size={12} />
              {decision.due}
            </span>
          )}
        </div>
      </div>
      <Button variant="signal" asChild>
        <Link to={decision.to} search={decision.search as never} params={decision.params as never}>
          {decision.action}
          <ArrowRight />
        </Link>
      </Button>
    </li>
  );
}

function Today() {
  const overview = useQuery(resource<Overview>("overview", "/overview"));
  const operational = useQuery({
    ...resource<OperationalOverviewView>("operational-overview", "/overview/operational"),
    refetchInterval: 30_000,
  });
  const projects = useQuery(resource<ProjectView[]>("projects", "/projects"));
  const server = useQuery({
    ...resource<ServerObservationView>("server-observation", "/infrastructure/server"),
    refetchInterval: 60_000,
  });
  const plans = useQuery({
    ...resource<OrchestrationOverviewView>("orchestration", "/agents/orchestration"),
    refetchInterval: 15_000,
  });
  const incidents = useQuery({
    ...resource<IncidentOverviewView>("incidents", "/incidents"),
    refetchInterval: 30_000,
  });
  const agents = useQuery({
    ...resource<AgentOverviewView>("agents", "/agents"),
    refetchInterval: 15_000,
  });
  if (overview.isError)
    return <Failure error={overview.error} retry={() => void overview.refetch()} />;
  if (!overview.data) return <Loading />;

  const now = Date.now();
  const projectList = projects.data ?? [];
  const decisions = buildDecisions(plans.data?.plans ?? [], operational.data, projectList, now);
  const decisionCount = Math.max(decisions.length, operational.data?.pendingDecisions ?? 0);
  const incidentList = openIncidents(incidents.data);
  const running = (agents.data?.tasks ?? []).filter((task) => ACTIVE_TASKS.has(task.state));
  const unknownJobs = operational.data?.jobs.unknown ?? 0;
  const cpu = cpuLoadPercent(server.data);
  const memory = memoryUsedPercent(server.data);
  const usage = operational.data?.usage ?? null;
  const urgent = decisions.find((decision) => decision.urgent);
  const watchCount = incidentList.length + (unknownJobs ? 1 : 0);
  const today = new Date(now).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="today">
      <header className="hero">
        <div>
          <p className="hero-eyebrow">{today.charAt(0).toLocaleUpperCase("fr") + today.slice(1)}</p>
          <h1>
            {decisionCount === 0
              ? "Rien ne vous attend."
              : `${decisionCount} décision${decisionCount > 1 ? "s" : ""} vous attend${decisionCount > 1 ? "ent" : ""}.`}
          </h1>
          <p className="hero-lede">
            {watchCount === 0
              ? "Aucun incident ouvert ni effet inconnu."
              : `${incidentList.length} incident${incidentList.length > 1 ? "s" : ""} ouvert${incidentList.length > 1 ? "s" : ""}${unknownJobs ? ` et ${unknownJobs} job${unknownJobs > 1 ? "s" : ""} au résultat inconnu` : ""}.`}{" "}
            {overview.data.mode === "local"
              ? "Mode local : aucun serveur distant n’est connecté."
              : "Plan de contrôle servi par le serveur dédié."}
          </p>
        </div>
        <div className="hero-actions">
          <Button variant="outline" asChild>
            <Link to="/projects/new">
              <Plus />
              Nouveau projet
            </Link>
          </Button>
        </div>
      </header>

      <section className="vitals" aria-label="Indicateurs">
        <a className={`vital ${decisionCount ? "accent" : ""}`} href="#decisions">
          <span className="vital-label">À décider</span>
          <strong className="big">{decisionCount}</strong>
          <span className="vital-foot">
            {urgent ? (
              <>
                la plus urgente <b>{urgent.due}</b>
              </>
            ) : decisionCount ? (
              "aucune échéance proche"
            ) : (
              "boîte vide"
            )}
          </span>
        </a>
        <Link className="vital" to="/journal" search={{ vue: "observabilite" } as never}>
          <span className="vital-label">Incidents ouverts</span>
          <strong className="big">{incidents.data ? incidentList.length : "—"}</strong>
          <span className="vital-foot">
            {incidents.data?.notifier === "configured" ? (
              <Truth kind="obs">alertes externes configurées</Truth>
            ) : (
              <Truth kind="unk">aucun canal d’alerte externe</Truth>
            )}
          </span>
        </Link>
        <Link className="vital" to="/costs">
          <span className="vital-label">Consommation enregistrée</span>
          <strong className="big">
            {usage?.conservativeChargedMicros !== null &&
            usage?.conservativeChargedMicros !== undefined
              ? (usage.conservativeChargedMicros / 1_000_000).toLocaleString("fr-FR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : "—"}
            <small>$</small>
          </strong>
          <span className="vital-foot">
            <Truth kind={usage?.completeness === "complete" ? "obs" : "est"}>
              {usage?.estimatedMicros !== null && usage?.estimatedMicros !== undefined
                ? `estimé ${dollars(usage.estimatedMicros)} · `
                : ""}
              {usage?.completeness === "complete"
                ? "relevé complet"
                : usage?.attemptCount
                  ? "relevé partiel"
                  : "aucun usage enregistré"}
            </Truth>
          </span>
        </Link>
        <Link className="vital" to="/platform/server">
          <span className="vital-label">Serveur</span>
          <strong className="big">
            {cpu ?? "—"}
            <small>{cpu === null ? "charge non mesurée" : "% charge"}</small>
          </strong>
          <Meter used={memory} max={100} unit="% mémoire" label="Mémoire inconnue" />
          <span className="vital-foot">
            {uptimeLabel(server.data)
              ? `en ligne depuis ${uptimeLabel(server.data)}`
              : "état non observé"}
          </span>
        </Link>
      </section>

      <section className="card ribbon-card" aria-label="Frise du jour">
        <div className="card-head">
          <h2>Aujourd’hui</h2>
          <span className="legend">
            <Truth kind="obs">passé enregistré</Truth>
            <Truth kind="decl">échéance prévue</Truth>
          </span>
        </div>
        <DayRibbon
          now={new Date(now)}
          events={ribbonEvents(
            overview.data.recentActivity,
            incidentList,
            plans.data?.plans ?? [],
            projectList,
          )}
        />
      </section>

      <div className="today-grid">
        <div className="col">
          <section className="card" id="decisions" aria-labelledby="decisions-title">
            <div className="card-head">
              <h2 id="decisions-title">À décider</h2>
              <span className={`count-pill ${decisions.length ? "" : "quiet"}`}>
                {decisions.length}
              </span>
            </div>
            {decisions.length ? (
              <ul className="decisions">
                {decisions.map((decision) => (
                  <DecisionRow key={decision.id} decision={decision} />
                ))}
              </ul>
            ) : (
              <p className="faint">
                Aucun plan, question ou approbation en attente. Les demandes d’Hermes et les
                échéances apparaîtront ici.
              </p>
            )}
          </section>

          <section className="card" aria-labelledby="watch-title">
            <div className="card-head">
              <h2 id="watch-title">À surveiller</h2>
              <Link className="link" to="/journal" search={{ vue: "observabilite" } as never}>
                Incidents <ArrowUpRight size={13} />
              </Link>
            </div>
            {watchCount ? (
              <ul className="watch">
                {unknownJobs > 0 && (
                  <li>
                    <Link to="/platform/jobs" className="watch-item unk">
                      <span className="tile signal">
                        <CircleHelp size={16} />
                      </span>
                      <div>
                        <strong>
                          {unknownJobs} job{unknownJobs > 1 ? "s" : ""} au résultat inconnu
                        </strong>
                        <p>Réconciliation en lecture seule, aucune relance automatique.</p>
                      </div>
                    </Link>
                  </li>
                )}
                {incidentList.slice(0, 5).map((incident) => (
                  <li key={incident.id}>
                    <Link
                      to="/journal"
                      search={{ vue: "observabilite" } as never}
                      className={`watch-item ${incident.severity === "critical" ? "danger" : "unk"}`}
                    >
                      <span
                        className={`tile ${incident.severity === "critical" ? "danger" : "signal"}`}
                      >
                        <AlertTriangle size={16} />
                      </span>
                      <div>
                        <strong>{incident.summary}</strong>
                        <p>
                          {incident.projectId
                            ? scopeLabel(projectList, incident.projectId, incident.environmentId)
                            : "plateforme"}{" "}
                          · {incident.occurrences} occurrence{incident.occurrences > 1 ? "s" : ""}
                        </p>
                      </div>
                      <StatusPill tone={incident.severity === "critical" ? "danger" : "warn"}>
                        {incident.state === "acknowledged" ? "pris en compte" : "ouvert"}
                      </StatusPill>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="faint">Aucun incident ouvert ni résultat inconnu.</p>
            )}
          </section>
        </div>

        <div className="col">
          <section className="card" aria-labelledby="hermes-title">
            <div className="card-head">
              <h2 id="hermes-title">Hermes</h2>
              <Link className="link" to="/hermes">
                Ouvrir <ArrowUpRight size={13} />
              </Link>
            </div>
            {running.length ? (
              <ul className="running">
                {running.slice(0, 4).map((task) => (
                  <li key={task.id}>
                    <div className="running-top">
                      <strong>{task.input}</strong>
                      <HermesMark size={18} />
                    </div>
                    <span className="mono faint">
                      {scopeLabel(projectList, task.projectId, task.environmentId)}
                    </span>
                    <StepsBar total={3} done={task.state === "queued" ? 0 : 1} running />
                    <span className="faint small">
                      {task.state === "queued" ? "en file" : "en cours"} · démarrée{" "}
                      {relativeTime(task.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="faint">
                {agents.data?.status === "available"
                  ? "Aucune tâche en cours."
                  : "Runtime Hermes non connecté sur ce plan de contrôle."}
              </p>
            )}
          </section>

          <section className="card" aria-labelledby="projects-title">
            <div className="card-head">
              <h2 id="projects-title">Projets</h2>
              <Link className="link" to="/projects">
                Tous <ArrowUpRight size={13} />
              </Link>
            </div>
            {projectList.length ? (
              <div className="mini-projects">
                {projectList.slice(0, 6).map((project) => (
                  <Link
                    key={project.id}
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                  >
                    <span className="mp-name">{project.name}</span>
                    <span className="mp-envs">
                      {project.environments.map((environment) => (
                        <span
                          key={environment.id}
                          title={`${environment.name} : ${environment.status}`}
                          className={`dot ${environment.status === "ready" ? "ok" : environment.status === "unknown" ? "unk" : environment.status === "suspended" || environment.status === "quarantined" ? "warn" : "decl"}`}
                        />
                      ))}
                    </span>
                    <span className="mono faint">{project.slug}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="faint">Aucun projet pour le moment.</p>
            )}
          </section>

          <section className="card" aria-labelledby="activity-title">
            <div className="card-head">
              <h2 id="activity-title">Activité</h2>
              <Link className="link" to="/journal">
                Journal <ArrowUpRight size={13} />
              </Link>
            </div>
            {overview.data.recentActivity.length ? (
              <ol className="activity">
                {overview.data.recentActivity.slice(0, 6).map((entry) => (
                  <li key={entry.id}>
                    <time className="mono faint" dateTime={entry.occurredAt}>
                      {new Date(entry.occurredAt).toDateString() === new Date(now).toDateString()
                        ? new Date(entry.occurredAt).toLocaleTimeString("fr-FR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : new Date(entry.occurredAt).toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "2-digit",
                          })}
                    </time>
                    <span className="activity-text" title={entry.summary}>
                      <b>{entry.action}</b> {entry.summary}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="faint">Aucune activité pour le moment.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
