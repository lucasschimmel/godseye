import type { ProjectView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Bot, Globe, LayoutGrid, List, Plus, Search, Server } from "lucide-react";
import { useState } from "react";
import { Dot, StatusPill } from "@/components/ds/viz";
import { ProjectTable } from "@/components/project-table";
import { Failure, Loading, PageHeading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { resource, timestamp } from "@/lib/api";
import {
  ENVIRONMENT_STATUS_LABEL,
  environmentTone,
  PROJECT_KIND_LABEL,
  projectState,
} from "@/lib/project-status";

export const Route = createFileRoute("/projects/")({ component: Projects });

const KIND_ICON = { web: Globe, api: Server, worker: Bot } as const;

function ProjectCard({ project }: { project: ProjectView }) {
  const state = projectState(project);
  const Icon = KIND_ICON[project.kind];
  const memory = project.environments.reduce((sum, environment) => sum + environment.memoryMiB, 0);
  return (
    <Link
      className={`card project-card ${state.tone}`}
      to="/projects/$projectId"
      params={{ projectId: project.id }}
    >
      <div className="pc-head">
        <span className="tile">
          <Icon size={17} />
        </span>
        <div>
          <strong>{project.name}</strong>
          <span className="mono faint">
            {project.repository ? project.repository.fullName : project.slug}
          </span>
        </div>
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
      </div>
      <div className="pc-envs">
        {project.environments.map((environment) => (
          <span
            key={environment.id}
            className={`env ${environmentTone(environment.status)}`}
            title={ENVIRONMENT_STATUS_LABEL[environment.status]}
          >
            <Dot tone={environmentTone(environment.status)} />
            {environment.name}
          </span>
        ))}
      </div>
      <dl className="pc-stats">
        <div>
          <dt>Type</dt>
          <dd>{PROJECT_KIND_LABEL[project.kind]}</dd>
        </div>
        <div>
          <dt>Mémoire réservée</dt>
          <dd className="mono">{(memory / 1024).toLocaleString("fr-FR")} Go</dd>
        </div>
        <div>
          <dt>Modifié</dt>
          <dd>{timestamp(project.updatedAt)}</dd>
        </div>
      </dl>
    </Link>
  );
}

function Projects() {
  const projects = useQuery(resource<ProjectView[]>("projects", "/projects"));
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const filtered = projects.data?.filter(({ name, slug }) =>
    `${name} ${slug}`.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr")),
  );
  const environments = projects.data?.reduce((sum, p) => sum + p.environments.length, 0) ?? 0;
  return (
    <>
      <PageHeading
        eyebrow="Portefeuille"
        title="Projets"
        description={
          projects.data
            ? `${projects.data.length} projet${projects.data.length > 1 ? "s" : ""}, ${environments} environnement${environments > 1 ? "s" : ""} isolé${environments > 1 ? "s" : ""}.`
            : "Vos sites, API et workers."
        }
        action={
          <>
            <label className="search-pill">
              <Search size={14} />
              <input
                aria-label="Rechercher un projet"
                placeholder="Rechercher un projet…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="seg">
              <button
                type="button"
                aria-pressed={layout === "grid"}
                aria-label="Grille"
                onClick={() => setLayout("grid")}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                type="button"
                aria-pressed={layout === "list"}
                aria-label="Liste"
                onClick={() => setLayout("list")}
              >
                <List size={14} />
              </button>
            </div>
            <Button asChild>
              <Link to="/projects/new">
                <Plus /> Nouveau projet
              </Link>
            </Button>
          </>
        }
      />
      {projects.isError ? (
        <Failure error={projects.error} retry={() => void projects.refetch()} />
      ) : !filtered ? (
        <Loading />
      ) : filtered.length === 0 && search ? (
        <p className="faint">Aucun projet ne correspond à « {search} ».</p>
      ) : layout === "list" ? (
        <section className="panel">
          <ProjectTable projects={filtered} />
        </section>
      ) : (
        <div className="project-grid">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
          <Link className="card project-card new" to="/projects/new">
            <span className="tile">
              <Plus size={18} />
            </span>
            <strong>Nouveau projet</strong>
            <span className="faint small">
              Environnements isolés, base dédiée et identités séparées.
            </span>
          </Link>
        </div>
      )}
    </>
  );
}
