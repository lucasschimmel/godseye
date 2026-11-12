import type { Overview, ProjectView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Box,
  Cpu,
  GitBranch,
  Plus,
  Server,
} from "lucide-react";
import { ProjectTable } from "@/components/project-table";
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
      <section className="overview-banner">
        <div>
          <span className="eyebrow">VOTRE ESPACE EST PRÊT</span>
          <h2>
            Préparez ici.
            <br />
            Déployez chez vous.
          </h2>
          <p>
            Enregistrez vos projets et associez vos dépôts. Le raccordement à votre AX41 viendra
            après la validation du socle local.
          </p>
          <Link to="/projects/new" className="text-link">
            Préparer un projet <ArrowRight size={15} />
          </Link>
        </div>
        <div className="control-graphic" aria-hidden="true">
          <div className="orbit orbit-outer" />
          <div className="orbit orbit-inner" />
          <div className="control-core">
            <Cpu size={35} strokeWidth={1} />
            <small>G.O.D.S.E.Y.E</small>
          </div>
          <span className="orbit-label label-top">PROJECTS</span>
          <span className="orbit-label label-bottom">YOUR INFRASTRUCTURE</span>
          <span className="orbit-node node-one" />
          <span className="orbit-node node-two" />
          <span className="orbit-node node-three" />
        </div>
      </section>
      <div className="metric-grid">
        {[
          {
            label: "Projets enregistrés",
            value: data.projectCount,
            note: "Dans le registre local",
            icon: Box,
          },
          {
            label: "Environnements prévus",
            value: data.environmentCount,
            note: "Aucune ressource provisionnée",
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
            Les consommations seront disponibles après connexion du serveur.
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
