import type { DeliveryOverviewView, EnvironmentView, ProjectView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { resource, timestamp } from "@/lib/api";
import { ENVIRONMENT_STATUS_LABEL, environmentTone } from "@/lib/project-status";
import { relativeTime } from "@/lib/server-metrics";
import { StatusPill, Truth, type TruthKind } from "../ds/viz";
import { ProjectTimeline } from "../observability-panel";

type StageState = "done" | "run" | "unk" | "fail" | "pending";
interface Stage {
  label: string;
  state: StageState;
  note: string;
}

const RUNNING = new Set(["reserved", "building", "built", "staged"]);

/** Preparation → build → scan → live, from the latest delivery of this environment. */
export function deliveryStages(
  delivery: DeliveryOverviewView | undefined,
  environmentId: string,
): { stages: Stage[]; updatedAt: string | null; commit: string | null } {
  const runs = (delivery?.deployments ?? [])
    .filter((run) => run.environmentId === environmentId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const latest = runs[0];
  if (!latest)
    return {
      stages: [
        { label: "Préparation", state: "pending", note: "aucune livraison" },
        { label: "Build", state: "pending", note: "—" },
        { label: "Scan", state: "pending", note: "—" },
        { label: "En ligne", state: "pending", note: "—" },
      ],
      updatedAt: null,
      commit: null,
    };
  const preparation = delivery?.preparations.find((item) => item.id === latest.preparationId);
  const artifact = delivery?.artifacts.find((item) => item.id === latest.artifactId);
  const live: Stage =
    latest.state === "active"
      ? { label: "En ligne", state: "done", note: "version active" }
      : latest.state === "unknown"
        ? { label: "En ligne", state: "unk", note: "issue inconnue, réconciliation" }
        : latest.state === "quarantined"
          ? { label: "En ligne", state: "fail", note: latest.reason ?? "mise en quarantaine" }
          : RUNNING.has(latest.state)
            ? { label: "En ligne", state: "run", note: "en cours" }
            : {
                label: "En ligne",
                state: "pending",
                note: latest.state === "retired" ? "retirée" : "libérée",
              };
  return {
    stages: [
      {
        label: "Préparation",
        state: preparation ? "done" : "pending",
        note: preparation ? `commit ${preparation.commitSha.slice(0, 7)}` : "—",
      },
      {
        label: "Build",
        state: artifact ? "done" : latest.state === "building" ? "run" : "pending",
        note: artifact ? `${(artifact.sizeBytes / 1_048_576).toFixed(1)} Mo` : "—",
      },
      {
        label: "Scan",
        state: artifact
          ? artifact.checks.every((check) => check.passed)
            ? "done"
            : "fail"
          : "pending",
        note: artifact ? `${artifact.checks.length} contrôles` : "—",
      },
      live,
    ],
    updatedAt: latest.updatedAt,
    commit: preparation?.commitSha ?? artifact?.commitSha ?? null,
  };
}

export function Pipeline({ stages }: { stages: Stage[] }) {
  return (
    <ol className="pipeline">
      {stages.map((stage) => (
        <li key={stage.label} className={stage.state}>
          <span className="pip" aria-hidden="true">
            {stage.state === "done" ? (
              <Check size={12} />
            ) : stage.state === "fail" ? (
              <X size={12} />
            ) : null}
          </span>
          <div>
            <strong>{stage.label}</strong>
            <span className="mono">{stage.note}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Guards({ environment }: { environment: EnvironmentView }) {
  const rows: [TruthKind, string, string][] = [
    ["decl", "Bac à sable gVisor par service", "profil déclaré ; vérifié lors du provisionnement"],
    ["decl", "PostgreSQL dédié à cet environnement", "instance, données et WAL séparés"],
    environment.recoveryHold
      ? ["unk", "Maintien de récupération actif", "applications, jobs, agents et accès bloqués"]
      : ["obs", "Aucun maintien de récupération", "activation possible"],
    environment.deliveryHold
      ? ["unk", "Livraison suspendue", "preview expirée ou en cours d’arrêt"]
      : [
          "obs",
          "Aucune suspension de livraison",
          "une politique active reste nécessaire pour livrer",
        ],
  ];
  return (
    <ul className="guards">
      {rows.map(([kind, title, detail]) => (
        <li key={title} className={kind}>
          <Truth kind={kind} />
          <div>
            <strong>{title}</strong>
            <span className="dim">{detail}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ProjectOverview({
  project,
  environment,
}: {
  project: ProjectView;
  environment: EnvironmentView;
}) {
  const delivery = useQuery(resource<DeliveryOverviewView>("delivery", "/delivery"));
  const path = deliveryStages(delivery.data, environment.id);
  const tone = environmentTone(environment.status);
  return (
    <div className="section-gap">
      <section className="kpis" aria-label="Environnement">
        <div className="kpi">
          <span className="label">État</span>
          <StatusPill tone={tone}>{ENVIRONMENT_STATUS_LABEL[environment.status]}</StatusPill>
          <span className="faint small">révision {environment.revision}</span>
        </div>
        <div className="kpi">
          <span className="label">Mémoire</span>
          <strong className="mid">
            {(environment.memoryMiB / 1024).toLocaleString("fr-FR")}
            <small>Go</small>
          </strong>
          <Truth kind="decl">plafond déclaré</Truth>
        </div>
        <div className="kpi">
          <span className="label">Processeur</span>
          <strong className="mid">
            {(environment.cpuMilliCores / 1000).toLocaleString("fr-FR")}
            <small>vCPU</small>
          </strong>
          <Truth kind="decl">plafond déclaré</Truth>
        </div>
        <div className="kpi">
          <span className="label">Stockage</span>
          <strong className="mid">
            {environment.diskGiB}
            <small>Go</small>
          </strong>
          <Truth kind="decl">
            {environment.expiresAt
              ? `expire ${relativeTime(environment.expiresAt)}`
              : "plafond déclaré"}
          </Truth>
        </div>
      </section>
      <section className="card">
        <div className="card-head">
          <h2>Chemin de la version</h2>
          <span className="mono faint">
            {path.commit ? `${path.commit.slice(0, 7)} · ` : ""}
            {path.updatedAt ? timestamp(path.updatedAt) : "aucune livraison enregistrée"}
          </span>
        </div>
        <Pipeline stages={path.stages} />
        {delivery.data?.execution === "unconfigured" && (
          <p className="faint small pipeline-note">
            Exécuteur de livraison non configuré sur ce plan de contrôle : aucune version ne peut
            être construite ici.
          </p>
        )}
      </section>
      <div className="two">
        <section className="card">
          <div className="card-head">
            <h2>Garde-fous</h2>
            <span className="legend">
              <Truth kind="obs">observé</Truth>
              <Truth kind="decl">déclaré</Truth>
              <Truth kind="unk">à vérifier</Truth>
            </span>
          </div>
          <Guards environment={environment} />
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Dépôt</h2>
          </div>
          {project.repository ? (
            <dl className="kv compact">
              <div>
                <dt>Dépôt</dt>
                <dd className="mono">{project.repository.fullName}</dd>
              </div>
              <div>
                <dt>Branche</dt>
                <dd className="mono">{project.repository.branch}</dd>
              </div>
              <div>
                <dt>Auto</dt>
                <dd>
                  {project.repository.autoDeploy
                    ? "préférence de déploiement automatique (sans autorité seule)"
                    : "déploiement manuel"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="faint">Aucun dépôt associé. Associez-le dans les réglages du projet.</p>
          )}
        </section>
      </div>
      <ProjectTimeline projectId={project.id} />
    </div>
  );
}
