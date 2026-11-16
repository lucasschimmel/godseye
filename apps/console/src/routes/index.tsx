import type { Overview, ProjectView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowUpRight, Box, GitBranch, Plus, Server } from "lucide-react";
import { OperationalOverview } from "@/components/operational-overview";
import { ProjectTable } from "@/components/project-table";
import { ServerTiles } from "@/components/server-tiles";
import { Failure, Loading, PageHeading, SectionTitle, Status } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { resource, timestamp } from "@/lib/api";

export const Route = createFileRoute("/")({ component: Dashboard });

function Dashboard() {
  const overview = useQuery(resource<Overview>("overview", "/overview"));
  const projects = useQuery(resource<ProjectView[]>("projects", "/projects"));
  if (overview.isError)
    return <Failure error={overview.error} retry={() => void overview.refetch()} />;
  if (!overview.data) return <Loading />;
  const data = overview.data;
  return (
    <>
      <PageHeading
        eyebrow="CENTRE DE CONTRÔLE"
        title="Vue d’ensemble"
        description="Vos projets, vos services et leurs opérations, au même endroit."
        action={
          <Button asChild>
            <Link to="/projects/new">
              <Plus size={16} /> Nouveau projet
            </Link>
          </Button>
        }
      />
      <ServerTiles />
      <OperationalOverview />
      <div className="metric-grid">
        {[
          {
            label: "Projets enregistrés",
            value: data.projectCount,
            note: data.mode === "server" ? "Dans le registre du serveur" : "Dans le registre local",
            icon: Box,
          },
          {
            label: "Environnements",
            value: data.environmentCount,
            note: "Environnements du registre",
            icon: Server,
          },
          {
            label: "Opérations",
            value: data.operationCount,
            note: "Journal persistant",
            icon: Activity,
          },
          {
            label: "Exécutions CI",
            value: data.ciRunCount,
            note: "Événements reçus",
            icon: GitBranch,
          },
        ].map(({ label, value, note, icon: Icon }) => (
          <div className="metric" key={label}>
            <div>
              <span>{label}</span>
              <Icon size={17} />
            </div>
            <strong>{value.toString().padStart(2, "0")}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <SectionTitle count={data.projectCount}>Projets</SectionTitle>
            <Link className="text-link subtle" to="/projects">
              Tout voir <ArrowUpRight size={14} />
            </Link>
          </div>
          {projects.isError ? (
            <Failure error={projects.error} />
          ) : projects.data ? (
            <ProjectTable projects={projects.data.slice(0, 5)} compact />
          ) : (
            <Loading />
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <SectionTitle>Connexions</SectionTitle>
            <Link to="/infrastructure" className="text-link subtle">
              <ArrowUpRight size={15} />
              <span className="sr-only">Voir l’infrastructure</span>
            </Link>
          </div>
          <div className="connection-list">
            {data.capabilities.slice(0, 5).map((capability) => (
              <div key={capability.id}>
                <span className="service-icon">
                  <Server size={16} />
                </span>
                <span>{capability.name}</span>
                <Status value={capability.status} />
              </div>
            ))}
          </div>
          <div className="panel-note">
            {data.mode === "server"
              ? "Serveur dédié connecté. Les mesures de la VM sont affichées ci-dessus ; celles de l’hôte Proxmox apparaissent dès que son rapport est lisible."
              : "Les observations locales sont disponibles ci-dessus. Les métriques de l’hôte distant restent indisponibles."}
          </div>
        </section>
      </div>
      <section className="panel activity-panel">
        <div className="panel-heading">
          <SectionTitle>Dernières activités</SectionTitle>
          <Link to="/operations" className="text-link subtle">
            Ouvrir le journal <ArrowUpRight size={14} />
          </Link>
        </div>
        {data.recentActivity.length ? (
          <div className="activity-list">
            {data.recentActivity.map((entry) => (
              <div key={entry.id}>
                <span className="activity-dot" />
                <div>
                  <strong>{entry.action}</strong>
                  <p>{entry.summary}</p>
                </div>
                <time dateTime={entry.occurredAt}>{timestamp(entry.occurredAt)}</time>
              </div>
            ))}
          </div>
        ) : (
          <p className="quiet-empty">
            Aucune activité pour le moment. Votre première configuration apparaîtra ici.
          </p>
        )}
      </section>
    </>
  );
}
