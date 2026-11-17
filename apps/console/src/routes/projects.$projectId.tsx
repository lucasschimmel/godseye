import type { DeliveryOverviewView, ProjectView } from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bot,
  CheckCheck,
  Database,
  Globe,
  LayoutGrid,
  type LucideIcon,
  Plus,
  Rocket,
  Server,
  Settings2,
  Shield,
} from "lucide-react";
import { BackendPanel } from "@/components/backend-panel";
import { DomainsPanel } from "@/components/domains-panel";
import { Dot, StatusPill } from "@/components/ds/viz";
import { LifecyclePanel } from "@/components/lifecycle-panel";
import { ProjectOverview } from "@/components/project/project-overview";
import {
  EnvironmentMetadataForm,
  PreviewEnvironmentForm,
  ProjectMetadataForm,
} from "@/components/project-management";
import { RepositoryForm } from "@/components/repository-form";
import { Failure, Loading, Status } from "@/components/shared";
import { usePageCrumb } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { api, resource, timestamp } from "@/lib/api";
import { environmentLabel } from "@/lib/environment-labels";
import { environmentTone, PROJECT_KIND_LABEL, projectState } from "@/lib/project-status";
import { useDeployment } from "@/lib/use-deployment";

const TABS = {
  apercu: { label: "Aperçu", icon: LayoutGrid },
  livraison: { label: "Livraison", icon: Rocket },
  domaines: { label: "Domaines", icon: Globe },
  backend: { label: "Backend", icon: Database },
  cycle: { label: "Cycle de vie", icon: Shield },
  reglages: { label: "Réglages", icon: Settings2 },
} as const satisfies Record<string, { label: string; icon: LucideIcon }>;
type Tab = keyof typeof TABS;

export const Route = createFileRoute("/projects/$projectId")({
  validateSearch: (search: Record<string, unknown>): { onglet?: Tab; env?: string } => ({
    onglet:
      typeof search.onglet === "string" && search.onglet in TABS
        ? (search.onglet as Tab)
        : undefined,
    env: typeof search.env === "string" ? search.env : undefined,
  }),
  component: ProjectDetail,
});

const KIND_ICON = { web: Globe, api: Server, worker: Bot } as const;

function DeliveryTab({ project }: { project: ProjectView }) {
  const delivery = useQuery(resource<DeliveryOverviewView>("delivery", "/delivery"));
  if (delivery.isError)
    return <Failure error={delivery.error} retry={() => void delivery.refetch()} />;
  if (!delivery.data) return <Loading />;
  const runs = delivery.data.deployments
    .filter((run) => run.projectId === project.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const policies = delivery.data.policies.filter((policy) => policy.projectId === project.id);
  return (
    <div className="section-gap">
      <section className="card flush">
        <div className="card-head pad">
          <h2>Déploiements</h2>
          <span className="legend">
            {policies.length
              ? `${policies.length} politique${policies.length > 1 ? "s" : ""} de livraison`
              : "aucune politique de livraison"}
          </span>
        </div>
        {runs.length ? (
          <ol className="releases">
            {runs.slice(0, 25).map((run) => {
              const preparation = delivery.data.preparations.find(
                (item) => item.id === run.preparationId,
              );
              const environment = project.environments.find((e) => e.id === run.environmentId);
              return (
                <li key={run.id} className={run.state === "active" ? "live" : run.state}>
                  <span className="commit-dot" aria-hidden="true" />
                  <div className="rel-main">
                    <span className="mono">{preparation?.commitSha.slice(0, 7) ?? "—"}</span>
                    <strong>{environment?.name ?? "environnement inconnu"}</strong>
                    <span className="faint small">
                      {run.intent} · {timestamp(run.updatedAt)}
                    </span>
                  </div>
                  <Status value={run.state} />
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="faint pad-block">
            Aucun déploiement pour ce projet. Les politiques, builds et previews se gèrent dans
            Livraison.
          </p>
        )}
      </section>
      <Link className="link" to="/platform/delivery">
        Politiques, sources et previews dans Livraison
      </Link>
    </div>
  );
}

function SettingsTab({ project }: { project: ProjectView }) {
  return (
    <div className="section-gap">
      <div className="detail-grid">
        <ProjectMetadataForm key={`metadata-${project.id}`} project={project} />
        <PreviewEnvironmentForm project={project} />
      </div>
      <div className="environment-grid">
        {project.environments.map((environment) => (
          <section
            key={environment.id}
            className="panel environment-card"
            aria-label={`Environnement ${environment.name}`}
          >
            <div className="environment-heading">
              <h3>{environmentLabel(environment)}</h3>
              <Status value={environment.status} />
            </div>
            {environment.recoveryHold && (
              <p role="status">
                Maintien de récupération : activation bloquée. Applications, tâches, agents et accès
                de service restent bloqués.
              </p>
            )}
            <dl>
              <div>
                <dt>Mémoire prévue</dt>
                <dd>{environment.memoryMiB / 1024} Go</dd>
              </div>
              <div>
                <dt>CPU prévu</dt>
                <dd>{environment.cpuMilliCores / 1000} vCPU</dd>
              </div>
              <div>
                <dt>Stockage prévu</dt>
                <dd>{environment.diskGiB} Go</dd>
              </div>
            </dl>
            <p className="muted">
              {environment.recoveryHold
                ? "Cette destination enregistrée ne prouve pas une restauration physique. Consultez les sauvegardes et restaurations pour connaître le résultat vérifié."
                : environment.status === "planned" || environment.status === "expired"
                  ? "Aucun service déployé. Les métriques seront disponibles après provisionnement."
                  : "L’état affiché concerne l’allocation PostgreSQL vérifiée. Les limites modifiées restent demandées."}
            </p>
            {environment.expiresAt && (
              <p className="muted">
                Expiration : {new Date(environment.expiresAt).toLocaleString("fr-FR")}
              </p>
            )}
            <EnvironmentMetadataForm project={project} environment={environment} />
          </section>
        ))}
      </div>
      <section className="panel">
        <RepositoryForm key={project.id} project={project} />
      </section>
    </div>
  );
}

function ProjectDetail() {
  const { projectId } = Route.useParams();
  const { onglet = "apercu", env } = Route.useSearch();
  const query = useQuery(resource<ProjectView>(`project-${projectId}`, `/projects/${projectId}`));
  const cache = useQueryClient();
  const deployment = useDeployment();
  usePageCrumb(query.data?.name ?? null);
  const validation = useMutation({
    mutationFn: () =>
      api(`/projects/${projectId}/operations`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          action: "project.validate",
          expectedRevision: query.data?.revision,
        }),
      }),
    onSuccess: () => cache.invalidateQueries(),
  });
  if (query.isError) return <Failure error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  const project = query.data;
  const state = projectState(project);
  const environment =
    project.environments.find((item) => item.id === env) ??
    project.environments.find((item) => item.kind === "production") ??
    project.environments[0];
  const Icon = KIND_ICON[project.kind];
  return (
    <>
      <header className="project-hero">
        <div className="ph-id">
          <span className="tile lg">
            <Icon size={22} />
          </span>
          <div>
            <div className="ph-title">
              <h1>{project.name}</h1>
              <StatusPill tone={state.tone}>{state.label}</StatusPill>
            </div>
            <p className="hero-lede ph-meta">
              <span className="mono">
                {project.repository
                  ? `${project.repository.fullName} · ${project.repository.branch}`
                  : project.slug}
              </span>
              <span className="sep-dot" aria-hidden="true" />
              {PROJECT_KIND_LABEL[project.kind]}
              <span className="sep-dot" aria-hidden="true" />
              <span className="mono">révision {project.revision}</span>
              <span className="sep-dot" aria-hidden="true" />
              modifié {timestamp(project.updatedAt)}
            </p>
          </div>
        </div>
        <div className="hero-actions">
          <Button
            variant="outline"
            disabled={validation.isPending}
            onClick={() => validation.mutate()}
          >
            <CheckCheck />
            {validation.isPending ? "Validation…" : "Valider la configuration"}
          </Button>
        </div>
      </header>
      {validation.isError && <Failure error={validation.error} />}
      {validation.isSuccess && (
        <p className="success-message" role="status">
          {deployment.isLocal ? "Configuration locale validée" : "Configuration validée"}. Le projet
          n’a pas été provisionné.
        </p>
      )}
      {project.description && <p className="dim project-description">{project.description}</p>}
      <div className="project-bar">
        {project.environments.length > 0 && (
          <nav className="seg" aria-label="Environnement">
            {project.environments.map((item) => (
              <Link
                key={item.id}
                to="/projects/$projectId"
                params={{ projectId }}
                search={{ onglet, env: item.id }}
                aria-current={item.id === environment?.id ? "page" : undefined}
              >
                <Dot tone={environmentTone(item.status)} />
                {item.name}
              </Link>
            ))}
            <Link
              to="/projects/$projectId"
              params={{ projectId }}
              search={{ onglet: "reglages" }}
              aria-label="Ajouter une preview"
              title="Ajouter une preview"
            >
              <Plus size={13} />
            </Link>
          </nav>
        )}
        <nav className="tabs" aria-label="Sections du projet">
          {(Object.keys(TABS) as Tab[]).map((key) => {
            const TabIcon = TABS[key].icon;
            return (
              <Link
                key={key}
                to="/projects/$projectId"
                params={{ projectId }}
                search={{ onglet: key, env }}
                aria-current={onglet === key ? "page" : undefined}
              >
                <TabIcon size={14} />
                {TABS[key].label}
              </Link>
            );
          })}
        </nav>
      </div>
      {onglet === "apercu" &&
        (environment ? (
          <ProjectOverview project={project} environment={environment} />
        ) : (
          <p className="faint">Ce projet n’a aucun environnement.</p>
        ))}
      {onglet === "livraison" && <DeliveryTab project={project} />}
      {onglet === "domaines" && <DomainsPanel project={project} />}
      {onglet === "backend" && <BackendPanel project={project} />}
      {onglet === "cycle" && <LifecyclePanel project={project} />}
      {onglet === "reglages" && <SettingsTab project={project} />}
    </>
  );
}
