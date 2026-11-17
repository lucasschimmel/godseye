import type {
  InfrastructureHeadroomView,
  InfrastructureOverviewView,
  OwnerSecurityView,
  ProjectDTO,
} from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Fingerprint, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { DomainsOverview } from "@/components/domains-overview";
import { InfrastructureHeadroomPanel } from "@/components/infra-headroom-panel";
import { InfrastructureInventoryForm } from "@/components/infra-inventory-form";
import { InfrastructureWorkloadForm } from "@/components/infra-workload-form";
import { useOwner } from "@/components/owner-gate";
import { ServerPanel } from "@/components/server-panel";
import { EmptyState, Failure, Loading, PageHeading, SectionTitle } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { api, resource, timestamp } from "@/lib/api";
import {
  infrastructureFilesystem,
  infrastructureReason,
  infrastructureStates,
} from "@/lib/infra-labels";
import { collectedMeasuresServerNote, headroomEvidence } from "@/lib/infra-server-truth";
import { ownerAuth } from "@/lib/owner";
import { useDeployment } from "@/lib/use-deployment";

export const Route = createFileRoute("/platform/server")({ component: Infrastructure });
function Infrastructure() {
  const owner = useOwner();
  const deployment = useDeployment();
  const inventory = useQuery(
    resource<InfrastructureOverviewView>("infrastructure", "/infrastructure"),
  );
  const headroom = useQuery(
    resource<InfrastructureHeadroomView>("infrastructure-headroom", "/infrastructure/headroom"),
  );
  const security = useQuery(resource<OwnerSecurityView>("owner-security", "/owner/security"));
  const projects = useQuery(resource<ProjectDTO[]>("projects", "/projects"));
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<Error | null>(null),
    [message, setMessage] = useState("");
  const fresh = security.data?.fresh ?? false;
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setFailure(null);
    setMessage("");
    try {
      await work();
      await Promise.all([
        inventory.refetch(),
        headroom.refetch(),
        security.refetch(),
        owner.refresh(),
      ]);
    } catch (error) {
      setFailure(error instanceof Error ? error : new Error("L’action n’a pas abouti."));
    } finally {
      setBusy(false);
    }
  }
  async function mutate(path: string, input: unknown, method = "POST") {
    await api(path, {
      method,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    });
  }
  const data = inventory.data;
  return (
    <>
      <PageHeading
        eyebrow="Plateforme"
        title="Serveur"
        description="Mesures réelles, inventaire souhaité et préparation isolée des environnements."
        action={
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const result = await ownerAuth.signIn.passkey();
                if (result.error) throw new Error("La confirmation a échoué.");
                setMessage("Votre identité a été confirmée.");
              })
            }
          >
            <Fingerprint size={15} />
            Confirmer mon identité
          </Button>
        }
      />
      {failure && <Failure error={failure} />}
      {message && (
        <p role="status" className="success-message">
          {message}
        </p>
      )}
      {inventory.isPending ? (
        <Loading />
      ) : inventory.isError ? (
        <Failure error={inventory.error} retry={() => void inventory.refetch()} />
      ) : (
        data && (
          <>
            <section className="panel owner-assurance">
              <ShieldCheck size={24} />
              <div>
                <h2>
                  {data.executionAvailable ? "Admission disponible" : "Exécution non qualifiée"}
                </h2>
                <p>
                  {deployment.isLocal
                    ? "Un seul hôte Proxmox, une VM professionnelle, une VM jeux et une éventuelle VM tâche. Les cellules restent dans la VM professionnelle."
                    : "Un seul serveur dédié héberge la VM professionnelle (console, API, cellules et services), la VM jeux et, si elle est déclarée, une VM tâche jetable. Les cellules des projets restent dans la VM professionnelle."}
                </p>
                <p>
                  {deployment.isLocal
                    ? "Le contrôleur local ne certifie ni le serveur dédié, ni les quotas persistants, ni le filtrage hôte et réseau dans les deux familles."
                    : "Le contrôleur observe la VM professionnelle où il s’exécute. Les quotas persistants, le filtrage réseau dans les deux familles et l’exécution isolée des environnements restent à qualifier sur le serveur."}
                </p>
                {!fresh && (
                  <p>
                    Confirmez votre identité pour modifier l’inventaire ou préparer un
                    environnement.
                  </p>
                )}
              </div>
            </section>
            <ServerPanel />
            <DomainsOverview />
            <div className="infrastructure-grid">
              <section className="panel">
                <div className="panel-heading">
                  <SectionTitle>Mesures collectées</SectionTitle>
                  <Button
                    variant="outline"
                    disabled={busy || !fresh}
                    onClick={() =>
                      void action(async () => {
                        await mutate("/infrastructure/refresh", {
                          expectedRevision: data.observationRevision,
                        });
                        setMessage(
                          deployment.isLocal
                            ? "Mesures locales actualisées. La qualification du serveur reste distincte."
                            : "Mesures actualisées. La qualification de l’exécution reste distincte.",
                        );
                      })
                    }
                  >
                    <RefreshCw size={15} />
                    Actualiser les mesures
                  </Button>
                </div>
                {data.observation ? (
                  <div className="infra-observation">
                    <Server size={24} />
                    <h3>
                      {data.observation.target === "development-controller"
                        ? "PC de développement local"
                        : "VM professionnelle observée"}
                    </h3>
                    <p>{data.observation.platform}</p>
                    <p>
                      {data.observationState === "stale" ? "Mesures périmées" : "Observé"} ·
                      révision {data.observationRevision} · {timestamp(data.observation.observedAt)}
                    </p>
                    <dl className="infra-metrics">
                      <div>
                        <dt>CPU disponible</dt>
                        <dd>{data.observation.capacity.cpuMilliCores} millicœurs</dd>
                      </div>
                      <div>
                        <dt>Mémoire totale</dt>
                        <dd>{data.observation.capacity.memoryMiB} MiB</dd>
                      </div>
                      <div>
                        <dt>Plafond PID mesuré</dt>
                        <dd>{data.observation.capacity.pids ?? "Indisponible"}</dd>
                      </div>
                    </dl>
                    {data.observation.filesystem && (
                      <p>
                        {infrastructureFilesystem(data.observation.filesystem.label)} ·{" "}
                        {data.observation.filesystem.availableGiB} GiB disponibles /{" "}
                        {data.observation.filesystem.totalGiB} GiB au total. Espace du système de
                        fichiers, quota non certifié.
                      </p>
                    )}
                    <p className="muted">
                      Source : {data.observation.source} · {data.observation.version}
                    </p>
                  </div>
                ) : (
                  <p className="panel-note">
                    {deployment.isServer
                      ? collectedMeasuresServerNote
                      : "Aucune mesure collectée. Les capacités du serveur dédié restent inconnues."}
                  </p>
                )}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <SectionTitle>Admission et isolation</SectionTitle>
                </div>
                <p className="panel-note">
                  Une préparation ne réserve rien. Une admission réserve atomiquement CPU, mémoire,
                  PID, données et sous-réseaux privés. Un résultat incertain conserve ces
                  réservations jusqu’à preuve exacte.
                </p>
                <ul className="infra-reasons">
                  {data.executionReasons.map((reason) => (
                    <li key={reason} title={reason}>
                      {infrastructureReason(reason)}
                    </li>
                  ))}
                </ul>
                <p className="panel-note">
                  Aucun port public, base de données, accès administrateur ou service du serveur
                  n’est publié par ce parcours.
                </p>
              </section>
            </div>
            {headroom.data && (
              <InfrastructureHeadroomPanel
                data={headroom.data}
                fresh={fresh}
                busy={busy}
                evidence={headroomEvidence(deployment.isServer, data)}
                onAdmission={(state, reason) =>
                  void action(async () => {
                    await mutate(
                      "/infrastructure/admission",
                      { expectedRevision: headroom.data?.admission.revision ?? 0, state, reason },
                      "PUT",
                    );
                    setMessage(state === "paused" ? "Admission suspendue." : "Admission rouverte.");
                  })
                }
              />
            )}
            <section className="panel" id="inventaire-souhaite">
              <div className="panel-heading">
                <SectionTitle>Inventaire souhaité</SectionTitle>
                <span className="muted">
                  {data.desired ? `Déclaré · révision ${data.revision}` : "Non déclaré"}
                </span>
              </div>
              <details open={!data.desired}>
                <summary>
                  {data.desired
                    ? `Modifier ${data.desired.host.name}`
                    : "Déclarer la topologie souhaitée"}
                </summary>
                <InfrastructureInventoryForm
                  key={`${data.revision}-${deployment.mode ?? "unknown"}`}
                  serverDefaults={deployment.isServer}
                  overview={data}
                  disabled={busy || !fresh}
                  save={(input) =>
                    action(async () => {
                      await mutate("/infrastructure/inventory", input, "PUT");
                      setMessage(
                        "Inventaire souhaité enregistré. Les mesures et la qualification restent indépendantes.",
                      );
                    })
                  }
                />
              </details>
              {data.desired && (
                <p className="panel-note">
                  {data.desired.host.name} · {data.desired.guests.length} VM prévues · pool{" "}
                  {data.desired.pool.capacity.memoryMiB} MiB /{" "}
                  {data.desired.pool.capacity.storageGiB} GiB · {data.desired.publicIpv4Count} IPv4
                  publique(s) souhaitée(s).
                </p>
              )}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <SectionTitle>Préparer un environnement</SectionTitle>
              </div>
              {projects.isError ? (
                <Failure error={projects.error} />
              ) : !projects.data?.length ? (
                <p className="panel-note">Créez un projet avant de préparer son environnement.</p>
              ) : (
                <InfrastructureWorkloadForm
                  projects={projects.data}
                  disabled={busy || !fresh || !data.desired}
                  prepare={(input) =>
                    action(async () => {
                      await mutate("/infrastructure/preparations", input);
                      setMessage(
                        "Préparation immuable enregistrée. Aucune application n’a démarré.",
                      );
                    })
                  }
                />
              )}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <SectionTitle count={data.preparations.length}>Préparations immuables</SectionTitle>
              </div>
              {!data.preparations.length ? (
                <EmptyState
                  title="Aucune préparation"
                  description="Compilez un profil d’application à partir d’une image OCI épinglée par son empreinte."
                />
              ) : (
                <div className="infra-items">
                  {data.preparations.map((preparation) => (
                    <article key={preparation.id}>
                      <h3>
                        Préparé ·{" "}
                        {projects.data?.find((project) => project.id === preparation.projectId)
                          ?.name ?? preparation.projectId}
                      </h3>
                      <p className="mono">{preparation.manifest.image}</p>
                      <p>
                        Allocation physique distincte :{" "}
                        <span className="mono">{preparation.allocationId}</span>
                      </p>
                      <p>
                        {preparation.manifest.network.ipv4Subnet} ·{" "}
                        {preparation.manifest.network.ipv6Subnet}
                      </p>
                      <p className="mono muted">Empreinte : {preparation.hash}</p>
                      <Button
                        disabled={
                          busy ||
                          !fresh ||
                          !data.executionAvailable ||
                          data.allocations.some(
                            (allocation) =>
                              allocation.environmentId === preparation.environmentId &&
                              allocation.state !== "released",
                          )
                        }
                        onClick={() =>
                          void action(async () => {
                            await mutate("/infrastructure/admissions", {
                              preparationId: preparation.id,
                              expectedHash: preparation.hash,
                            });
                            setMessage(
                              "Admission enregistrée. Le résultat sera vérifié après inspection effective.",
                            );
                          })
                        }
                      >
                        Admettre cette préparation
                      </Button>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <SectionTitle count={data.allocations.length}>
                  Allocations et réservations
                </SectionTitle>
              </div>
              {!data.allocations.length ? (
                <p className="panel-note">
                  Aucune réservation physique. Les préparations ne provisionnent pas le serveur.
                </p>
              ) : (
                <div className="infra-items">
                  {data.allocations.map((allocation) => (
                    <article key={allocation.id}>
                      <h3>{infrastructureStates[allocation.state]}</h3>
                      <p className="mono">{allocation.id}</p>
                      <p>
                        {allocation.ipv4Subnet} · {allocation.ipv6Subnet}
                      </p>
                      {allocation.reason && <p>{allocation.reason}</p>}
                      {allocation.cleanupState === "pending" && (
                        <p>
                          Arrêt de protection incertain ; vérification requise, réservation
                          conservée.
                        </p>
                      )}
                      {allocation.cleanupState === "stopped" && (
                        <p>
                          Application arrêtée par protection ; données et réservations conservées.
                        </p>
                      )}
                      {["unknown", "quarantined"].includes(allocation.state) && (
                        <p>
                          Réservation conservée ; une preuve exacte d’état ou d’absence est
                          nécessaire.
                        </p>
                      )}
                      {allocation.runId && allocation.state !== "released" && (
                        <div className="infra-actions">
                          <Button
                            variant="outline"
                            disabled={busy || !fresh}
                            onClick={() =>
                              void action(async () => {
                                await mutate(`/foundation/runs/${allocation.runId}/cancel`, {});
                                setMessage(
                                  "Autorité annulée. Les effets incertains et les données sont conservés.",
                                );
                              })
                            }
                          >
                            Annuler l’autorité
                          </Button>
                          {["unknown", "quarantined"].includes(allocation.state) && (
                            <Button
                              variant="outline"
                              disabled={busy || !fresh}
                              onClick={() =>
                                void action(async () => {
                                  await mutate(
                                    `/foundation/runs/${allocation.runId}/reconcile`,
                                    {},
                                  );
                                  setMessage(
                                    "Réconciliation demandée ; aucune recréation automatique.",
                                  );
                                })
                              }
                            >
                              Réconcilier
                            </Button>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )
      )}
    </>
  );
}
