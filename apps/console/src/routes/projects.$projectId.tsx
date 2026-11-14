import type { ProjectView } from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCheck, Database, GitBranch, Layers, ShieldCheck } from "lucide-react";
import { BackendPanel } from "@/components/backend-panel";
import { LifecyclePanel } from "@/components/lifecycle-panel";
import { ProjectTimeline } from "@/components/observability-panel";
import {
  EnvironmentMetadataForm,
  PreviewEnvironmentForm,
  ProjectMetadataForm,
} from "@/components/project-management";
import { RepositoryForm } from "@/components/repository-form";
import { Failure, Loading, PageHeading, Status } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { api, resource } from "@/lib/api";
import { environmentLabel } from "@/lib/environment-labels";

export const Route = createFileRoute("/projects/$projectId")({ component: ProjectDetail });
function ProjectDetail() {
  const { projectId } = Route.useParams();
  const query = useQuery(resource<ProjectView>(`project-${projectId}`, `/projects/${projectId}`));
  const cache = useQueryClient();
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
  return (
    <>
      <Link to="/projects" className="back-link">
        <ArrowLeft size={14} /> Projets
      </Link>
      <PageHeading
        eyebrow={`${project.kind.toUpperCase()} / ${project.slug}`}
        title={project.name}
        description={project.description || "Configuration et environnements de votre projet."}
        action={
          <Button
            variant="outline"
            disabled={validation.isPending}
            onClick={() => validation.mutate()}
          >
            <CheckCheck size={16} />
            {validation.isPending ? "Validation…" : "Valider la configuration"}
          </Button>
        }
      />
      <ProjectTimeline projectId={projectId} />
      <div className="project-summary">
        <Status value={project.status} />
        <span className="mono">Révision {project.revision}</span>
        <span>
          <GitBranch size={14} />
          {project.repository
            ? `${project.repository.fullName} · ${project.repository.branch}`
            : "Aucun dépôt associé"}
        </span>
      </div>
      {validation.isError && <Failure error={validation.error} />}
      {validation.isSuccess && (
        <p className="success-message" role="status">
          Configuration locale validée. Le projet n’a pas été provisionné.
        </p>
      )}
      <div className="section-title">
        <h2>Environnements</h2>
        <span className="muted">Séparés dès la configuration</span>
      </div>
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
              <span className="service-icon">
                <Layers size={18} />
              </span>
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
            <div className="environment-profile">
              <ShieldCheck size={14} /> gVisor <span>·</span>
              <Database size={14} /> PostgreSQL dédié prévu
            </div>
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
            <EnvironmentMetadataForm
              key={environment.id}
              project={project}
              environment={environment}
            />
          </section>
        ))}
      </div>
      <LifecyclePanel project={project} />
      <Link to="/databases" className="text-link">
        Gérer les bases de données indépendantes
      </Link>
      <BackendPanel project={project} />
      <div className="detail-grid">
        <section className="panel">
          <RepositoryForm key={project.id} project={project} />
        </section>
        <aside className="panel detail-note">
          <ShieldCheck size={25} />
          <h2>Votre projet, son périmètre</h2>
          <p>
            Les environnements auront leurs propres réseaux, accès, volumes, base de données et
            tâches Inngest.
          </p>
          <p>
            Les applications partageront la VM professionnelle. La qualification du serveur
            vérifiera l’isolation effective avant la mise en production.
          </p>
          <Link to="/infrastructure" className="text-link">
            Voir l’architecture <ArrowLeft size={14} className="rotate-180" />
          </Link>
        </aside>
      </div>
    </>
  );
}
