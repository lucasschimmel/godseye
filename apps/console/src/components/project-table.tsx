import type { ProjectView } from "@godseye/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Box, GitBranch, Plus } from "lucide-react";
import { EmptyState, Status } from "./shared";
import { Button } from "./ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export function ProjectTable({
  projects,
  compact = false,
}: {
  projects: ProjectView[];
  compact?: boolean;
}) {
  if (!projects.length)
    return (
      <EmptyState
        title="Votre premier projet vous attend"
        description="Un site, une API ou un worker : commencez par enregistrer sa configuration."
      >
        <Button variant="outline" asChild>
          <Link to="/projects/new">
            <Plus size={15} /> Créer un projet
          </Link>
        </Button>
      </EmptyState>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Projet</TableHead>
          <TableHead>État</TableHead>
          {!compact && <TableHead>Dépôt</TableHead>}
          <TableHead>
            <span className="sr-only">Ouvrir</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map((project) => (
          <TableRow key={project.id}>
            <TableCell>
              <Link
                className="project-cell"
                to="/projects/$projectId"
                params={{ projectId: project.id }}
              >
                <span className="project-avatar">
                  <Box size={18} strokeWidth={1.5} />
                </span>
                <span>
                  <strong>{project.name}</strong>
                  <small>
                    {project.slug} <span>· {project.kind}</span>
                  </small>
                </span>
              </Link>
            </TableCell>
            <TableCell>
              <Status value={project.status} />
            </TableCell>
            {!compact && (
              <TableCell>
                <span className="repository-label">
                  <GitBranch size={13} />
                  {project.repository?.fullName ?? "Non associé"}
                </span>
              </TableCell>
            )}
            <TableCell>
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                aria-label={`Ouvrir ${project.name}`}
              >
                <ArrowUpRight size={17} />
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
