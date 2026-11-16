import type { AccessOverviewView, OwnerSecurityView, ProjectDTO } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Fingerprint, KeyRound, RefreshCw } from "lucide-react";
import { useState } from "react";
import { providerLabels, purposeLabels, states } from "@/components/access-labels";
import { useOwner } from "@/components/owner-gate";
import { EmptyState, Failure, Loading, PageHeading, SectionTitle } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, resource, timestamp } from "@/lib/api";
import { environmentLabel, ordinaryEnvironment } from "@/lib/environment-labels";
import { ownerAuth } from "@/lib/owner";
import {
  bindingLabels,
  bindingRows,
  IMPORT_EXPLANATION,
  providerExplanations,
} from "@/lib/secrets-bindings";
import { useDeployment } from "@/lib/use-deployment";

export const Route = createFileRoute("/access")({ component: AccessManagement });
function AccessManagement() {
  const owner = useOwner();
  const deployment = useDeployment();
  const access = useQuery(resource<AccessOverviewView>("access", "/access"));
  const projects = useQuery(resource<ProjectDTO[]>("projects", "/projects"));
  const security = useQuery(resource<OwnerSecurityView>("owner-security", "/owner/security"));
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [purpose, setPurpose] = useState("runtime");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const [message, setMessage] = useState("");
  const project = projects.data?.find((item) => item.id === projectId) ?? projects.data?.[0];
  const environments = project?.environments.filter(ordinaryEnvironment) ?? [];
  const environment = environments.find((item) => item.id === environmentId) ?? environments[0];
  const fresh = security.data?.fresh ?? false;
  const bindings = projects.data && access.data ? bindingRows(projects.data, access.data) : [];
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setFailure(null);
    setMessage("");
    try {
      await work();
      await Promise.all([access.refetch(), security.refetch(), owner.refresh()]);
    } catch (error) {
      setFailure(error instanceof Error ? error : new Error("L’action n’a pas abouti."));
    } finally {
      setBusy(false);
    }
  }
  async function post(path: string, body: unknown) {
    await api(path, {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(body),
    });
  }
  return (
    <>
      <PageHeading
        eyebrow="ACCÈS DES SERVICES"
        title="Secrets et identités de service"
        description="Isolez chaque usage dans son projet et son environnement. Les valeurs restent dans le circuit privé."
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
            <Fingerprint size={15} /> Confirmer mon identité
          </Button>
        }
      />
      {failure && <Failure error={failure} />}
      {message && (
        <p role="status" className="success-message">
          {message}
        </p>
      )}
      {access.isPending ? (
        <Loading />
      ) : access.isError ? (
        <Failure error={access.error} retry={() => void access.refetch()} />
      ) : (
        <>
          <section className="panel owner-assurance">
            <KeyRound size={24} />
            <div>
              <h2>{providerLabels[access.data.provider.state]}</h2>
              <p>{providerExplanations[access.data.provider.state]}</p>
              <p>
                {fresh
                  ? "Identité propriétaire confirmée récemment."
                  : "Confirmez votre identité avant de modifier les accès."}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await access.refetch();
                })
              }
            >
              <RefreshCw size={14} /> Actualiser
            </Button>
          </section>
          <div className="form-layout">
            <form
              className="panel project-form"
              aria-label="Créer une identité de service"
              onSubmit={(event) => {
                event.preventDefault();
                if (!project || !environment) return;
                const data = new FormData(event.currentTarget);
                void action(async () => {
                  await post("/access/identities", {
                    projectId: project?.id,
                    environmentId: environment.id,
                    name: data.get("name"),
                    purpose,
                    ...(purpose === "runtime" ? {} : { workerId: data.get("worker") }),
                  });
                  setMessage("L’identité de service a été créée.");
                });
              }}
            >
              <SectionTitle>Créer une identité de service</SectionTitle>
              <div className="field">
                <label htmlFor="access-project">Projet</label>
                <select
                  id="access-project"
                  required
                  value={project?.id ?? ""}
                  onChange={(event) => {
                    setProjectId(event.target.value);
                    setEnvironmentId("");
                  }}
                >
                  {!project && <option value="">Créez d’abord un projet</option>}
                  {projects.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="access-environment">Environnement</label>
                <select
                  id="access-environment"
                  name="environment"
                  key={project?.id}
                  required
                  value={environment?.id ?? ""}
                  onChange={(event) => setEnvironmentId(event.target.value)}
                >
                  {!environment && (
                    <option value="">Aucun environnement ordinaire disponible</option>
                  )}
                  {environments.map((item) => (
                    <option key={item.id} value={item.id}>
                      {environmentLabel(item)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="access-name">Nom de l’identité</label>
                <Input id="access-name" name="name" required maxLength={80} autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="access-purpose">Usage</label>
                <select
                  id="access-purpose"
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                >
                  {Object.entries(purposeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {purpose !== "runtime" && (
                <div className="field">
                  <label htmlFor="access-worker">Worker autorisé</label>
                  <Input
                    id="access-worker"
                    name="worker"
                    required
                    maxLength={128}
                    autoComplete="off"
                  />
                  <small>
                    Les accès de tâche exigent ce worker et un mandat d’exécution encore valide.
                  </small>
                </div>
              )}
              <div className="form-actions">
                <Button disabled={busy || !fresh || !project || !environment} type="submit">
                  Créer l’identité
                </Button>
              </div>
            </form>
            <aside className="form-aside">
              <h2>Un accès par usage</h2>
              <p>
                L’application, les migrations, les déploiements et les sauvegardes utilisent des
                identités distinctes.
              </p>
              <p>
                {IMPORT_EXPLANATION.where}{" "}
                {deployment.isLocal
                  ? "Ici, c’est le terminal local privé."
                  : "Avec le serveur, c’est une session SSH via WireGuard depuis votre poste."}
              </p>
              <p>{IMPORT_EXPLANATION.why}</p>
              <p>
                Une rotation exige un adaptateur qualifié qui confirme la transition du service et
                la révocation de l’ancien accès.
              </p>
            </aside>
          </div>
          <section className="panel" aria-label="Liaisons OpenBao par environnement">
            <div className="panel-heading">
              <SectionTitle count={bindings.length}>
                Liaisons OpenBao par environnement
              </SectionTitle>
            </div>
            <p className="muted">
              Noms, versions et dates uniquement ; aucune valeur. Un emplacement vide signifie
              qu’aucune valeur n’a encore été importée.
            </p>
            {bindings.length === 0 ? (
              <EmptyState
                title="Aucun environnement"
                description="Créez un projet pour lier ses environnements au coffre."
              />
            ) : (
              <ul className="rotation-roles">
                {bindings.map((row) => (
                  <li key={`${row.projectId}-${row.environmentId}`}>
                    <strong>
                      {row.projectName} · {row.environmentName}
                    </strong>{" "}
                    <span>{bindingLabels[row.state]}.</span>{" "}
                    <span className="muted">
                      {row.lastOperationAt
                        ? `Dernier import ou transition : ${timestamp(row.lastOperationAt)}.`
                        : "Aucun import ni transition enregistré."}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <SectionTitle count={access.data.identities.length}>
                Identités de service
              </SectionTitle>
            </div>
            {!access.data.identities.length && (
              <EmptyState
                title="Aucune identité de service"
                description="Créez un accès dédié à un projet, un environnement et un usage."
              />
            )}
            {access.data.identities.map((identity) => (
              <article
                key={identity.id}
                className="project-form"
                aria-label={`Identité ${identity.name}`}
              >
                <div className="panel-heading">
                  <div>
                    <h3>{identity.name}</h3>
                    <p>
                      {purposeLabels[identity.purpose]} · {states[identity.status]} · révision{" "}
                      {identity.revision}
                    </p>
                    <p className="mono">
                      {identity.projectId} / {identity.environmentId}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy || !fresh || identity.status === "revoked"}
                    onClick={() =>
                      void action(async () => {
                        await post(`/access/identities/${identity.id}/revoke`, {
                          expectedRevision: identity.revision,
                        });
                        setMessage(
                          "L’accès au broker est révoqué. Vérifiez séparément les accès déjà remis au service.",
                        );
                      })
                    }
                  >
                    Révoquer l’identité
                  </Button>
                </div>
                <p>
                  {identity.proofIssued ? "Preuve privée remise" : "Preuve privée à remettre"}
                  {identity.workerId ? ` · Worker ${identity.workerId}` : ""}
                </p>
                {identity.upstreamRevocation === "pending" && (
                  <p role="status">
                    La révocation des accès déjà montés reste à effectuer sur le service.
                  </p>
                )}
                <form
                  aria-label={`Créer un emplacement pour ${identity.name}`}
                  className="field-grid"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const data = new FormData(form);
                    void action(async () => {
                      await post("/access/slots", {
                        identityId: identity.id,
                        name: data.get("name"),
                      });
                      form.reset();
                      setMessage("L’emplacement a été créé.");
                    });
                  }}
                >
                  <div className="field">
                    <label htmlFor={`slot-${identity.id}`}>Nom de l’emplacement</label>
                    <Input
                      id={`slot-${identity.id}`}
                      name="name"
                      required
                      maxLength={80}
                      autoComplete="off"
                    />
                  </div>
                  <Button type="submit" disabled={busy || !fresh || identity.status !== "active"}>
                    Créer l’emplacement
                  </Button>
                </form>
                {access.data.slots
                  .filter((slot) => slot.identityId === identity.id)
                  .map((slot) => (
                    <div className="owner-session" key={slot.id}>
                      <div>
                        <strong>{slot.name}</strong>
                        <p>
                          {states[slot.state]} · version active {slot.activeVersion ?? "—"} ·
                          candidat {slot.stagedVersion ?? "—"}
                        </p>
                        <small className="mono">{slot.id}</small>
                      </div>
                      {slot.stagedVersion && access.data.adapters.length > 0 ? (
                        access.data.adapters.map((adapter) => (
                          <Button
                            key={adapter.id}
                            disabled={
                              busy ||
                              !fresh ||
                              identity.status !== "active" ||
                              slot.state !== "staged"
                            }
                            onClick={() =>
                              void action(async () => {
                                await post(`/access/slots/${slot.id}/activate`, {
                                  adapterId: adapter.id,
                                  expectedRevision: slot.revision,
                                });
                              })
                            }
                          >
                            Activer via {adapter.id}
                          </Button>
                        ))
                      ) : slot.stagedVersion ? (
                        <p>Transition et révocation à qualifier avant activation.</p>
                      ) : null}
                    </div>
                  ))}
              </article>
            ))}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <SectionTitle count={access.data.operations.length}>
                Imports et rotations
              </SectionTitle>
            </div>
            {access.data.operations.length ? (
              access.data.operations.map((operation) => (
                <div className="owner-session" key={operation.id}>
                  <div>
                    <strong>
                      {operation.kind === "stage"
                        ? "Préparation du candidat"
                        : "Transition du service"}
                    </strong>
                    <p>
                      {states[operation.state]} · candidat {operation.candidateVersion}
                    </p>
                    <small className="mono">{operation.id}</small>
                  </div>
                  {["pending", "unknown"].includes(operation.state) && (
                    <Button
                      disabled={busy || !fresh}
                      variant="outline"
                      onClick={() =>
                        void action(async () => {
                          await post(`/access/operations/${operation.id}/reconcile`, {});
                        })
                      }
                    >
                      Réconcilier
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <EmptyState
                title="Aucun import ni rotation"
                description="Les résultats incertains restent visibles jusqu’à leur réconciliation."
              />
            )}
          </section>
        </>
      )}
    </>
  );
}
