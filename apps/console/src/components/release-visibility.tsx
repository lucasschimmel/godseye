import type {
  CiRunView,
  DeliveryOverviewView,
  DeliveryRunView,
  EnvironmentView,
  OwnerSecurityView,
  ProjectView,
} from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
import { Failure, Loading, SectionTitle } from "@/components/shared";
import { api, resource, timestamp } from "@/lib/api";
import { buildLink } from "@/lib/build-link";
import { environmentLabel } from "@/lib/environment-labels";
import { redeployBlockReason } from "@/lib/redeploy";
import { RedeployControl } from "./redeploy-control";
import { TableScroll } from "./table-scroll";

/** Health as the delivery journal proves it; anything not proven active stays explicitly unknown. */
const healthLabels: Record<DeliveryRunView["state"], string> = {
  reserved: "Réservé, rien n’est déployé",
  building: "Construction en cours",
  built: "Artefact vérifié, non déployé",
  staged: "Préparé, pas encore actif",
  active: "En service (vérifié par la livraison)",
  retired: "Retiré",
  released: "Libéré sans effet",
  unknown: "Résultat incertain : réconciliation requise",
  quarantined: "En quarantaine",
};
const RECENT_BUILDS = 5;

interface Row {
  key: string;
  environmentView: EnvironmentView;
  project: string;
  environment: string;
  run: DeliveryRunView | null;
  commit: string | null;
  digest: string | null;
}

function rows(projects: ProjectView[], delivery: DeliveryOverviewView): Row[] {
  return projects.flatMap((project) =>
    project.environments
      .filter((environment) => environment.kind !== "recovery")
      .map((environment) => {
        const history = delivery.deployments
          .filter((run) => run.environmentId === environment.id && run.intent !== "cleanup")
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const run = history.find((item) => item.state === "active") ?? history[0] ?? null;
        const artifact = delivery.artifacts.find((item) => item.id === run?.artifactId);
        return {
          key: environment.id,
          environmentView: environment,
          project: project.name,
          environment: environmentLabel(environment),
          run,
          commit: artifact?.commitSha ?? null,
          digest: artifact?.digest ?? null,
        };
      }),
  );
}

/** Current release and deploy health per environment, plus recent builds with a Jenkins link when recorded. */
export function ReleaseVisibility() {
  const delivery = useQuery(resource<DeliveryOverviewView>("delivery", "/delivery"));
  const projects = useQuery(resource<ProjectView[]>("projects", "/projects"));
  const builds = useQuery(resource<CiRunView[]>("ci-runs", "/ci/runs"));
  const security = useQuery({
    ...resource<OwnerSecurityView>("owner-security", "/owner/security"),
    refetchInterval: 5000,
  });
  const cache = useQueryClient();
  const redeploy = useMutation({
    mutationFn: ({ environment, key }: { environment: EnvironmentView; key: string }) =>
      api("/delivery/redeploy", {
        method: "POST",
        body: JSON.stringify({
          environmentId: environment.id,
          expectedEnvironmentRevision: environment.revision,
        }),
        headers: { "idempotency-key": key },
      }),
    onSuccess: () => cache.invalidateQueries(),
  });
  return (
    <section className="panel" aria-labelledby="release-visibility-title">
      <div className="panel-heading">
        <SectionTitle>
          <span id="release-visibility-title">Versions en service</span>
        </SectionTitle>
        <Rocket size={18} />
      </div>
      <p className="panel-note">
        La version courante vient du journal de livraison. Sans déploiement vérifié, l’environnement
        est indiqué sans version : aucune version n’est supposée.
      </p>
      {delivery.isPending || projects.isPending ? (
        <Loading />
      ) : delivery.isError || projects.isError ? (
        <Failure
          error={delivery.error ?? projects.error ?? new Error("Livraison indisponible.")}
          retry={() => {
            void delivery.refetch();
            void projects.refetch();
          }}
        />
      ) : (
        <div className="panel-body">
          <TableScroll label="Tableau défilant : version courante par environnement">
            <table className="headroom-table">
              <caption className="sr-only">Version courante par environnement</caption>
              <thead>
                <tr>
                  <th scope="col">Projet</th>
                  <th scope="col">Environnement</th>
                  <th scope="col">Version</th>
                  <th scope="col">Santé du déploiement</th>
                  <th scope="col">Mis à jour</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows(projects.data, delivery.data).map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.project}</th>
                    <td>{row.environment}</td>
                    <td className="mono" title={row.digest ?? undefined}>
                      {row.commit ? row.commit.slice(0, 12) : "Aucune version déployée"}
                    </td>
                    <td>
                      {row.run ? healthLabels[row.run.state] : "Aucun déploiement enregistré"}
                    </td>
                    <td>{row.run ? timestamp(row.run.updatedAt) : "—"}</td>
                    <td>
                      <RedeployControl
                        project={row.project}
                        environment={row.environment}
                        commit={row.commit}
                        digest={row.digest}
                        pending={redeploy.isPending}
                        reason={redeployBlockReason({
                          environment: row.environmentView,
                          environmentId: row.key,
                          run: row.run,
                          delivery: delivery.data,
                          fresh: security.data?.fresh === true,
                          now: Date.now(),
                        })}
                        onConfirm={() =>
                          redeploy.mutate({
                            environment: row.environmentView,
                            key: crypto.randomUUID(),
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
      <div className="panel-body">
        {redeploy.isError && <Failure error={redeploy.error} />}
        {redeploy.isSuccess && (
          <p className="success-message" role="status">
            Redéploiement préparé sur la même image. Admettez-le dans « Livraisons préparées » pour
            l’exécuter.
          </p>
        )}
        <h3 className="panel-subheading">Dernières constructions</h3>
        {builds.isError ? (
          <Failure error={builds.error} />
        ) : !builds.data ? (
          <Loading />
        ) : builds.data.length === 0 ? (
          <p className="panel-caption">Aucune exécution reçue.</p>
        ) : (
          <ul className="build-list">
            {builds.data.slice(0, RECENT_BUILDS).map((run) => {
              const link = buildLink(run.providerRef ?? null);
              return (
                <li key={run.id}>
                  <span className="mono">{run.commitSha.slice(0, 12)}</span> · {run.projectName} ·{" "}
                  {run.branch} · {run.status}
                  {" · "}
                  {link ? (
                    <a href={link} target="_blank" rel="noreferrer noopener">
                      Voir le build Jenkins
                    </a>
                  ) : (
                    <span className="muted">Build Jenkins non rapporté</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
