import type { ProjectView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { ProjectTable } from "@/components/project-table";
import { Failure, Loading, PageHeading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resource } from "@/lib/api";

export const Route = createFileRoute("/projects/")({ component: Projects });
function Projects() {
  const projects = useQuery(resource<ProjectView[]>("projects", "/projects"));
  const [search, setSearch] = useState("");
  const filtered = projects.data?.filter(({ name, slug }) =>
    `${name} ${slug}`.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr")),
  );
  return (
    <>
      <PageHeading
        eyebrow="VOTRE PORTEFEUILLE"
        title="Projets"
        description="Les configurations de vos sites, back-ends et services."
        action={
          <Button asChild>
            <Link to="/projects/new">
              <Plus size={16} /> Nouveau projet
            </Link>
          </Button>
        }
      />
      <section className="panel">
        <div className="list-toolbar">
          <div className="search-field">
            <Search size={16} />
            <Input
              aria-label="Rechercher un projet"
              placeholder="Rechercher un projet…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <span className="muted">{projects.data?.length ?? 0} projet(s)</span>
        </div>
        {projects.isError ? (
          <Failure error={projects.error} retry={() => void projects.refetch()} />
        ) : filtered ? (
          filtered.length === 0 && search ? (
            <p className="quiet-empty">Aucun projet ne correspond à « {search} ».</p>
          ) : (
            <ProjectTable projects={filtered} />
          )
        ) : (
          <Loading />
        )}
      </section>
    </>
  );
}
